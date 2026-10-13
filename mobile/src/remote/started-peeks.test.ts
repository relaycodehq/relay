import { beforeEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../../shared/projects";
import type { RemoteChatSummary } from "../../../shared/remote";
import type { Thread } from "./chat-state";
import {
  flush,
  harnessReact,
  mount,
  rerender,
} from "../../../tests/unit/hook-harness";

const remote = vi.hoisted(() => ({
  status: "online",
  active: "A",
  call: vi.fn(),
  listeners: new Map<string, (event: { message: ChatMessage }) => void>(),
  onMessage: vi.fn(),
}));
const offline = vi.hoisted(() => ({
  loadThread: vi.fn(async (): Promise<Thread | undefined> => undefined),
  saveThread: vi.fn(),
}));
vi.mock("react", () => harnessReact);
vi.mock("./RemoteProvider", () => ({ useRemote: () => remote }));
vi.mock("./offline", () => offline);

let useStartedPeeks: typeof import("./started-peeks").useStartedPeeks;
beforeEach(async () => {
  vi.resetModules();
  remote.status = "online";
  remote.active = "A";
  remote.call.mockReset();
  remote.listeners.clear();
  remote.onMessage.mockImplementation(
    (id: string, listener: (event: { message: ChatMessage }) => void) => {
      remote.listeners.set(id, listener);
      return () => remote.listeners.delete(id);
    },
  );
  offline.loadThread.mockReset().mockResolvedValue(undefined);
  offline.saveThread.mockClear();
  ({ useStartedPeeks } = await import("./started-peeks"));
});

const answer = (
  body: string,
  version = 1,
  status: ChatMessage["status"] = "complete",
): ChatMessage => ({
  id: "m",
  role: "assistant",
  provider: "codex",
  body,
  status,
  created: 1,
  version,
});
const thread = (message: ChatMessage): Thread => ({
  id: "t",
  projectId: "p",
  title: "T",
  scope: { kind: "project" },
  running: false,
  earlier: 0,
  queue: [],
  scheduled: [],
  messages: [message],
  requests: [],
});
const started = (running = false): RemoteChatSummary[] =>
  [{ id: "t", running, waiting: false }] as RemoteChatSummary[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("catches a started thread's row up with an answer it gave while the link was down", async () => {
  remote.call.mockResolvedValue(thread(answer("First answer")));
  const peek = mount(() => useStartedPeeks(started()));
  await flush();
  expect(peek()("t").answer?.body).toBe("First answer");

  // Another turn finishes while disconnected; the summary still reads idle.
  remote.status = "offline";
  rerender();
  remote.call.mockResolvedValue(thread(answer("Second answer", 2)));
  remote.status = "online";
  rerender();
  await flush();
  expect(peek()("t").answer?.body).toBe("Second answer");
});

it("ignores a retired running-state fetch after the completed-state fetch succeeds", async () => {
  const slow = deferred<Thread>();
  remote.call
    .mockReturnValueOnce(slow.promise)
    .mockResolvedValue(thread(answer("Done", 2)));
  let summaries = started(true);
  const peek = mount(() => useStartedPeeks(summaries));
  await flush();
  summaries = started(false);
  rerender();
  await flush();
  expect(peek()("t").answer?.body).toBe("Done");
  slow.resolve(thread(answer("Working…", 1, "streaming")));
  await flush();
  expect(peek()("t").answer?.body).toBe("Done");
  expect(offline.saveThread).toHaveBeenCalledTimes(1);
  expect(offline.saveThread.mock.calls[0]![1].messages[0].body).toBe("Done");
});

it("keeps a newer live answer in both the peek and offline copy when the fetch finishes", async () => {
  const slow = deferred<Thread>();
  remote.call.mockReturnValue(slow.promise);
  const peek = mount(() => useStartedPeeks(started(true)));
  await flush();
  const completed = answer("Done", 2);
  remote.listeners.get("t")!({ message: completed });
  slow.resolve(thread(answer("Working…", 1, "streaming")));
  await flush();
  expect(peek()("t").answer).toEqual(completed);
  expect(offline.saveThread.mock.calls[0]![1].messages).toEqual([completed]);
});

it("keeps a live answer that was absent from the in-flight fetch", async () => {
  const slow = deferred<Thread>();
  remote.call.mockReturnValue(slow.promise);
  const peek = mount(() => useStartedPeeks(started(true)));
  await flush();
  const completed = { ...answer("Next turn"), id: "next", created: 2 };
  remote.listeners.get("t")!({ message: completed });
  const previous = answer("Previous turn");
  slow.resolve(thread(previous));
  await flush();
  expect(peek()("t").answer).toEqual(completed);
  expect(offline.saveThread.mock.calls[0]![1].messages).toEqual([
    previous,
    completed,
  ]);
});

it("allows a fresh snapshot to remove an old cached handoff answer", async () => {
  const mirrored = { ...answer("Away answer"), id: "away", created: 2 };
  const original = answer("Original answer");
  remote.call
    .mockResolvedValueOnce(thread(mirrored))
    .mockResolvedValue(thread(original));
  let summaries = started(true);
  const peek = mount(() => useStartedPeeks(summaries));
  await flush();
  expect(peek()("t").answer).toEqual(mirrored);
  summaries = started(false);
  rerender();
  await flush();
  expect(peek()("t").answer).toEqual(original);
  expect(offline.saveThread.mock.calls.at(-1)![1].messages).toEqual([original]);
});

it("doesn't call or save for a retired computer after its offline read finishes", async () => {
  const saved = deferred<Thread | undefined>();
  offline.loadThread.mockReturnValueOnce(saved.promise);
  remote.call.mockResolvedValue(thread(answer("Computer B")));
  const peek = mount(() => useStartedPeeks(started()));
  remote.active = "B";
  rerender();
  await flush();
  saved.resolve(thread(answer("Computer A")));
  await flush();
  expect(peek()("t").answer?.body).toBe("Computer B");
  expect(remote.call).toHaveBeenCalledTimes(1);
  expect(offline.saveThread).toHaveBeenCalledTimes(1);
});

it("restarts a retired pending fetch even when only another child's state changed", async () => {
  const slow = deferred<Thread>();
  remote.call
    .mockReturnValueOnce(slow.promise)
    .mockResolvedValue(thread(answer("Done", 2)));
  let summaries = [
    ...started(true),
    { id: "other", running: false },
  ] as RemoteChatSummary[];
  const peek = mount(() => useStartedPeeks(summaries));
  await flush();
  summaries = [
    ...started(true),
    { id: "other", running: true },
  ] as RemoteChatSummary[];
  rerender();
  await flush();
  expect(remote.call.mock.calls.filter((args) => args[1] === "t")).toHaveLength(
    2,
  );
  expect(peek()("t").answer?.body).toBe("Done");
  slow.resolve(thread(answer("Working…", 1, "streaming")));
  await flush();
  expect(peek()("t").answer?.body).toBe("Done");
});
