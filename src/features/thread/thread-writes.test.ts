import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposedSend } from "../../../shared/compose-send";
import type { ChatSummary } from "../../../shared/projects";

// No React renderer here: the hooks run as plain functions over a stand-in
// for useState/useRef that keeps slots between "renders" the way React does.
const react = vi.hoisted(() => {
  let slots: unknown[] = [];
  let next = 0;
  return {
    reset() {
      slots = [];
    },
    render<T>(hooks: () => T): T {
      next = 0;
      return hooks();
    },
    useState(init: unknown) {
      const at = next++;
      if (!(at in slots))
        slots[at] = typeof init === "function" ? init() : init;
      const set = (v: unknown) => {
        slots[at] = typeof v === "function" ? v(slots[at]) : v;
      };
      return [slots[at], set];
    },
    useRef(init: unknown) {
      const at = next++;
      if (!(at in slots)) slots[at] = { current: init };
      return slots[at];
    },
  };
});
vi.mock("react", () => ({ useState: react.useState, useRef: react.useRef }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: async () => {},
    setQueryData: () => {},
  }),
}));
const api = vi.hoisted(() => ({
  sendProjectChat: vi.fn(async (..._: unknown[]) => {}),
  resumeProjectChat: vi.fn(async (..._: unknown[]) => {}),
  projectChatQueueAction: vi.fn(async (..._: unknown[]) => {}),
}));
vi.mock("../../lib/api", () => ({ api }));

const { writeGate } = await import("./write-gate");
const { useThreadHandle } = await import("./useThreadHandle");
const { useThreadSend } = await import("./useThreadSend");
const { useQueuedMessages } = await import("./useQueuedMessages");

const chat = { id: "t1" } as ChatSummary;
const message = { body: "@codex go on", to: "codex" } as ComposedSend;
const aside = { ...message, side: true } as ComposedSend;
const attachments = {
  codeRefs: [],
  clear: () => {},
} as unknown as Parameters<typeof useThreadSend>[0]["attachments"];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** One render of the thread's write hooks; `confirm` stands in for the switch dialog. */
function renderThread(
  confirm: () => Promise<boolean> = async () => true,
  thread: ChatSummary | null = chat,
) {
  return react.render(() => {
    const handle = useThreadHandle(
      thread ?? undefined,
      "t1",
      "p1",
      async () => {},
    );
    const sending = useThreadSend({
      handle,
      newThread: async () => {},
      attachments,
      viewing: null,
      confirmSwitch: confirm,
      onSent: () => {},
      onOpen: () => {},
    });
    const queue = useQueuedMessages({
      handle,
      messages: [],
      queue: undefined,
      attachments,
      onOpen: () => {},
    });
    return { handle, ...sending, queue };
  });
}

beforeEach(() => {
  react.reset();
  vi.clearAllMocks();
});

describe("a thread's writes", () => {
  it("lets only one of two writes started in the same render through", async () => {
    const { handle } = renderThread();
    const first = deferred<void>();
    const a = handle.run(() => first.promise);
    const b = handle.run(async () => {});
    first.resolve();
    expect(await Promise.all([a, b])).toEqual([true, false]);
  });

  it("holds other writes off while the switch dialog is open", async () => {
    const dialog = deferred<boolean>();
    const sending = renderThread(() => dialog.promise).send(message);
    // React re-renders while the dialog shows; a queued message is steered.
    const later = renderThread(() => dialog.promise);
    await later.queue.steer("q1");
    expect(api.projectChatQueueAction).not.toHaveBeenCalled();
    expect(later.handle.busy).toBe(true);
    dialog.resolve(true);
    expect(await sending).toBe(true);
    expect(api.sendProjectChat).toHaveBeenCalledTimes(1);
    expect(renderThread().handle.busy).toBe(false);
  });

  it("refuses a resume while a send waits on the dialog", async () => {
    const dialog = deferred<boolean>();
    const asked = vi.fn(() => dialog.promise);
    const sending = renderThread(asked).send(message);
    const resuming = renderThread(asked).resume(() => undefined);
    expect(asked).toHaveBeenCalledTimes(1);
    dialog.resolve(true);
    await Promise.all([sending, resuming]);
    expect(api.resumeProjectChat).not.toHaveBeenCalled();
  });

  it("lets go when the switch is declined", async () => {
    const declined = await renderThread(async () => false).send(message);
    expect(declined).toBe(false);
    expect(renderThread().handle.busy).toBe(false);
    await renderThread().queue.steer("q1");
    expect(api.projectChatQueueAction).toHaveBeenCalledTimes(1);
  });

  it("lets go and shows the error when the send fails", async () => {
    api.sendProjectChat.mockRejectedValueOnce(new Error("offline"));
    expect(await renderThread().send(message)).toBe(false);
    const after = renderThread();
    expect(after.handle.busy).toBe(false);
    expect(after.handle.error).toEqual(new Error("offline"));
    expect(await after.send(message)).toBe(true);
  });

  it("sends a side question without waiting on itself", async () => {
    expect(await renderThread().send(aside)).toBe(true);
    expect(api.sendProjectChat).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ side: true }),
    );
    expect(renderThread().handle.busy).toBe(false);
  });

  it("lets go when a side question has no thread to go beside", async () => {
    expect(await renderThread(undefined, null).send(aside)).toBe(false);
    const after = renderThread(undefined, null);
    expect(after.handle.busy).toBe(false);
    expect(after.handle.error).toBeInstanceOf(Error);
  });
});

describe("the write gate", () => {
  function gate() {
    const busy: boolean[] = [];
    return {
      busy,
      ...writeGate({ onBusy: (b) => busy.push(b), onError: () => {} }),
    };
  }

  it("keeps the next holder's hold when a released write lets go again", async () => {
    const g = gate();
    const first = g.reserve()!;
    first.release();
    const second = g.reserve()!;
    first.release();
    expect(g.reserve()).toBeUndefined();
    expect(await first.run(async () => {})).toBe(false);
    expect(await second.run(async () => {})).toBe(true);
    expect(g.busy).toEqual([true, false, true, false]);
  });

  it("runs a held write once", async () => {
    const g = gate();
    const write = g.reserve()!;
    const work = vi.fn(async () => {});
    expect(await write.run(work)).toBe(true);
    expect(await write.run(work)).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
