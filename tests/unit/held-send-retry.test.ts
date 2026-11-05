// A phone's send of a new thread's draft the computer holds part of runs in
// two places: the main process waits on it (electron/drafts) and the desktop
// page makes the thread and sends (src/features/composer/held-sends). The
// main process gives up after 110s and the phone retries with the same send
// id; however that lines up with the page, one thread gets one message and
// the draft is cleared once.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DraftChange, HeldSend } from "../../shared/drafts";
import type { ProjectChatSend } from "../../shared/projects";
import { DraftStore, Drafts } from "../../electron/drafts";
import { RemoteBridge } from "../../electron/remote/bridge";
import type { RemoteHost } from "../../electron/remote/remote-host";

const api = vi.hoisted(() => ({
  onDraftSend: vi.fn(),
  waitingDraftSends: vi.fn(),
  finishDraftSend: vi.fn(),
  projects: vi.fn(async () => [{ id: "p1", path: "/p1" }]),
  createProjectChat: vi.fn(),
  sendProjectChat: vi.fn(),
  projectChats: vi.fn(),
}));

vi.mock("../../src/lib/api", () => ({ api }));

const saveDraftImages = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../src/features/images/draft-images", () => ({
  loadDraftImages: async () => [],
  saveDraftImages,
  draftImageCount: () => 0,
  draftsWithImages: () => [],
  readDraftImageCounts: async () => {},
  onDraftImageCount: () => () => {},
}));

import { followHeldSends } from "../../src/features/composer/held-sends";

let dir: string;
const storage = new Map<string, string>();
/** Each thread the page made, with the ids of the messages it got. */
const threads = new Map<string, string[]>();
/** What making a thread waits on, as a worktree would. */
let making: Promise<void>;
/** The page keeps a thread it made for a failed send by draft key, so each test has its own. */
let key: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-held-retry-"));
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, value: string) => storage.set(k, value),
    removeItem: (k: string) => storage.delete(k),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  });
  for (const fn of Object.values(api)) fn.mockReset();
  saveDraftImages.mockClear();
  api.projects.mockImplementation(async () => [{ id: "p1", path: "/p1" }]);
  threads.clear();
  api.projectChats.mockImplementation(async () =>
    [...threads.keys()].map((id) => ({ id })),
  );
  making = Promise.resolve();
  api.createProjectChat.mockImplementation(async () => {
    await making;
    const id = `chat-${threads.size + 1}`;
    threads.set(id, []);
    return { id };
  });
  // As the computer's threads do, a message whose id is in already isn't added again.
  api.sendProjectChat.mockImplementation(
    async (id: string, input: ProjectChatSend) => {
      const messages = threads.get(id)!;
      if (!messages.includes(input.id)) messages.push(input.id);
    },
  );
  key = `new:p1:${randomUUID().slice(0, 8)}`;
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

/** The main process and a desktop page that takes its held sends, wired as the app wires them. */
async function setup() {
  const store = new DraftStore(join(dir, "drafts.json"));
  await store.load();
  const changes: DraftChange[] = [];
  let page: ((request: HeldSend) => void) | undefined;
  const drafts = new Drafts(store, {
    changed: (change) => changes.push(change),
    deliver: (request) => (page?.(request), true),
  });
  api.onDraftSend.mockImplementation((listener) => {
    page = listener;
    return () => {};
  });
  api.waitingDraftSends.mockImplementation(async () => drafts.waitingSends());
  api.finishDraftSend.mockImplementation(async (id, result) =>
    drafts.finishSend(id, result),
  );
  followHeldSends();
  const bridge = new RemoteBridge(
    {
      projects: async () => [],
      chats: () => [],
      dispatch: async () => {},
      name: () => "Studio",
      drafts,
    } as unknown as RemoteHost,
    () => {},
  );
  const message: ProjectChatSend = {
    id: randomUUID(),
    body: "Fix this",
    provider: "codex",
    choice: { model: "", reasoningEffort: "", fast: false },
    runtimeMode: "auto",
    interactionMode: "default",
  };
  drafts.write(
    { key, text: message.body, base: 0, at: 1, extras: { codeRefs: 1 } },
    "desktop",
  );
  return {
    drafts,
    store,
    message,
    phoneSends: () => bridge.handle("sendDraft", [key, null, message]),
    /** How many times the main process cleared the draft for a send. */
    clears: () => changes.filter((change) => change.sent).length,
  };
}

/** The phone's first try, given up on after 110s. */
async function timesOut(first: Promise<unknown>) {
  const failed = expect(first).rejects.toThrow("in time");
  await vi.advanceTimersByTimeAsync(110_000);
  await failed;
}

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

it("joins the page's first try when the phone retries while it's still making the thread", async () => {
  const { message, phoneSends, clears, store } = await setup();
  const worktree = gate();
  making = worktree.promise;
  await timesOut(phoneSends());
  const retried = phoneSends();
  // The retry reaches the page side before the worktree is ready.
  await vi.advanceTimersByTimeAsync(0);
  worktree.open();
  await expect(retried).resolves.toEqual({ chatId: "chat-1" });
  expect([...threads]).toEqual([["chat-1", [message.id]]]);
  expect(clears()).toBe(1);
  expect(saveDraftImages).toHaveBeenCalledTimes(1);
  await store.flush();
});

it("answers a retry with the thread the page made after the phone gave up, keeping the next draft", async () => {
  const { drafts, message, phoneSends, clears, store } = await setup();
  const worktree = gate();
  making = worktree.promise;
  await timesOut(phoneSends());
  worktree.open();
  await vi.waitFor(() => expect(clears()).toBe(1));
  // The phone starts the next message before it tries again.
  drafts.write({ key, text: "And the footer", base: 0, at: 2 }, "phone:p");
  await expect(phoneSends()).resolves.toEqual({ chatId: "chat-1" });
  expect([...threads]).toEqual([["chat-1", [message.id]]]);
  expect(clears()).toBe(1);
  expect(drafts.list()).toMatchObject([{ key, text: "And the footer" }]);
  expect(saveDraftImages).toHaveBeenCalledTimes(1);
  await store.flush();
});

it("sends a retry to the thread the page made when its message failed after the phone gave up", async () => {
  const { message, phoneSends, clears, store } = await setup();
  const worktree = gate();
  making = worktree.promise;
  api.sendProjectChat.mockRejectedValueOnce(new Error("Codex isn't signed in"));
  await timesOut(phoneSends());
  worktree.open();
  await vi.waitFor(() => expect(api.finishDraftSend).toHaveBeenCalledOnce());
  expect(clears()).toBe(0);
  await expect(phoneSends()).resolves.toEqual({ chatId: "chat-1" });
  expect(api.createProjectChat).toHaveBeenCalledOnce();
  expect([...threads]).toEqual([["chat-1", [message.id]]]);
  expect(clears()).toBe(1);
  expect(saveDraftImages).toHaveBeenCalledTimes(1);
  await store.flush();
});

it("makes a new thread for a retry once the one its failed send made is deleted", async () => {
  const { message, phoneSends, store } = await setup();
  api.sendProjectChat.mockRejectedValueOnce(new Error("Codex isn't signed in"));
  await expect(phoneSends()).rejects.toThrow("signed in");
  threads.delete("chat-1");
  await expect(phoneSends()).resolves.toEqual({ chatId: "chat-1" });
  expect(api.createProjectChat).toHaveBeenCalledTimes(2);
  expect(threads.get("chat-1")).toEqual([message.id]);
  await store.flush();
});
