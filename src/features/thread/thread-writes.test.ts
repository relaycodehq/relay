// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mount, update, flush } from "../../../tests/unit/hook-harness";
import type { ComposedSend } from "../../../shared/compose-send";
import type { ChatSummary } from "../../../shared/projects";

const api = vi.hoisted(() => ({
  sendProjectChat: vi.fn(async (..._: unknown[]) => {}),
  resumeProjectChat: vi.fn(async (..._: unknown[]) => {}),
  projectChatQueueAction: vi.fn(async (..._: unknown[]) => {}),
}));
vi.mock("../../lib/api", () => ({ api }));

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
  let resolve!: (v: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** One render of the thread's write hooks; `confirm` stands in for the switch dialog. */
function threadHooks(
  confirm: () => Promise<boolean> = async () => true,
  thread: ChatSummary | null = chat,
) {
  const handle = useThreadHandle(
    thread ?? undefined,
    thread?.id ?? "t1",
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
}

let current:
  ReturnType<typeof mount<ReturnType<typeof threadHooks>>> | undefined;
let client: QueryClient;
let selected: Parameters<typeof threadHooks>;
function renderThread(...args: Parameters<typeof threadHooks>) {
  selected = args;
  if (current) current.rerender();
  else
    current = mount(
      () => threadHooks(...selected),
      (child) =>
        createElement(
          QueryClientProvider,
          { client, key: selected[1]?.id ?? "t1" },
          child,
        ),
    );
  return current();
}
function start<T>(
  action: (thread: ReturnType<typeof threadHooks>) => T,
  ...args: Parameters<typeof threadHooks>
) {
  const thread = renderThread(...args);
  return update(() => action(thread));
}
async function complete<T>(promise: Promise<T>) {
  let value!: T;
  await act(async () => {
    value = await promise;
  });
  return value;
}
beforeEach(() => {
  current = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});
afterEach(() => client.clear());

describe("a thread's writes", () => {
  it("lets only one of two writes started in the same render through", async () => {
    const { handle } = renderThread();
    const first = deferred<void>();
    const [a, b] = update(() => [
      handle.run(() => first.promise),
      handle.run(async () => {}),
    ]);
    expect(current!().handle.busy).toBe(true);
    first.resolve();
    expect(await complete(Promise.all([a, b]))).toEqual([true, false]);
  });

  it("holds other writes off while the switch dialog is open", async () => {
    const dialog = deferred<boolean>();
    const sending = start(
      (thread) => thread.send(message),
      () => dialog.promise,
    );
    // React re-renders while the dialog shows; a queued message is steered.
    const later = renderThread(() => dialog.promise);
    await complete(update(() => later.queue.steer("q1")));
    expect(api.projectChatQueueAction).not.toHaveBeenCalled();
    expect(later.handle.busy).toBe(true);
    dialog.resolve(true);
    expect(await complete(sending)).toBe(true);
    expect(api.sendProjectChat).toHaveBeenCalledTimes(1);
    expect(current!().handle.busy).toBe(false);
  });

  it("refuses a resume while a send waits on the dialog", async () => {
    const dialog = deferred<boolean>();
    const asked = vi.fn(() => dialog.promise);
    const sending = start((thread) => thread.send(message), asked);
    const resuming = start((thread) => thread.resume(() => undefined), asked);
    expect(asked).toHaveBeenCalledTimes(1);
    dialog.resolve(true);
    await complete(Promise.all([sending, resuming]));
    expect(api.resumeProjectChat).not.toHaveBeenCalled();
  });

  it("lets go when the switch is declined", async () => {
    const declined = await complete(
      start(
        (thread) => thread.send(message),
        async () => false,
      ),
    );
    expect(declined).toBe(false);
    expect(current!().handle.busy).toBe(false);
    await complete(start((thread) => thread.queue.steer("q1")));
    expect(api.projectChatQueueAction).toHaveBeenCalledTimes(1);
  });

  it("lets go and shows the error when the send fails", async () => {
    api.sendProjectChat.mockRejectedValueOnce(new Error("offline"));
    expect(await complete(start((thread) => thread.send(message)))).toBe(false);
    const after = renderThread();
    expect(after.handle.busy).toBe(false);
    expect(after.handle.error).toEqual(new Error("offline"));
    expect(await complete(update(() => after.send(message)))).toBe(true);
  });

  it("sends a side question without waiting on itself", async () => {
    expect(await complete(start((thread) => thread.send(aside)))).toBe(true);
    expect(api.sendProjectChat).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ side: true }),
    );
    expect(current!().handle.busy).toBe(false);
  });

  it("keeps a late write failure out of a newly mounted thread", async () => {
    const pending = deferred<void>();
    api.sendProjectChat.mockImplementationOnce(() => pending.promise);
    const oldWrite = start((thread) => thread.send(message));
    await flush();
    expect(current!().handle.busy).toBe(true);
    renderThread(undefined, { id: "t2" } as ChatSummary);
    expect(current!().handle.busy).toBe(false);
    expect(await complete(update(() => current!().send(message)))).toBe(true);
    pending.reject(new Error("old thread offline"));
    expect(await complete(oldWrite)).toBe(false);
    expect(current!().handle.busy).toBe(false);
    expect(current!().handle.error).toBeUndefined();
    expect(api.sendProjectChat.mock.calls.map(([id]) => id)).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("lets go when a side question has no thread to go beside", async () => {
    expect(
      await complete(start((thread) => thread.send(aside), undefined, null)),
    ).toBe(false);
    const after = renderThread(undefined, null);
    expect(after.handle.busy).toBe(false);
    expect(after.handle.error).toBeInstanceOf(Error);
  });
});
