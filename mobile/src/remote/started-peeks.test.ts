import { expect, it, vi } from "vitest";
import type { RemoteChatSummary } from "../../../shared/remote";

const remote = vi.hoisted(() => ({
  status: "online",
  active: "A",
  call: vi.fn(),
  onMessage: () => () => {},
}));
// Effects run at once; enough to drive the hook outside React.
vi.mock("react", () => ({
  useEffect: (fn: () => unknown) => void fn(),
  useSyncExternalStore: (_: unknown, get: () => unknown) => get(),
}));
vi.mock("./RemoteProvider", () => ({ useRemote: () => remote }));
vi.mock("./offline", () => ({ loadThread: async () => undefined, saveThread: () => {} }));

const { useStartedPeeks } = await import("./started-peeks");

const answer = (id: string, body: string) => ({
  id, role: "assistant", body, status: "complete", created: 1, version: 1,
});
const thread = (body: string) => ({
  id: "t", projectId: "p", title: "T", scope: { kind: "repository" }, running: false,
  earlier: 0, queue: [], scheduled: [], messages: [answer(body, body)],
});
const started = [{ id: "t", running: false, waiting: false }] as RemoteChatSummary[];
const settle = () => new Promise((r) => setTimeout(r, 0));

it("catches a started thread's row up with an answer it gave while the link was down", async () => {
  remote.call.mockResolvedValue(thread("First answer"));
  let peek = useStartedPeeks(started);
  await settle();
  expect(peek("t").answer?.body).toBe("First answer");

  // The link drops; meanwhile the lead sends the started thread another
  // message and it answers. Before and after, it reads idle and not waiting.
  remote.status = "offline";
  useStartedPeeks(started);
  remote.call.mockResolvedValue(thread("Second answer"));
  remote.status = "online";
  peek = useStartedPeeks(started);
  await settle();

  expect(peek("t").answer?.body).toBe("Second answer");
});
