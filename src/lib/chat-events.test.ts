import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type {
  ChatMessage,
  KnownMessages,
  ProjectChat,
  ProjectChatPatch,
} from "../../shared/projects";
import { ChatPushSender, type ProjectChatPush } from "../../shared/chat-pushes";
import { chatKey, fetchChat, followChatEvents } from "./chat-events";

const desktop = vi.hoisted(() => ({
  push: (_: ProjectChatPush) => {},
  subscriptions: 0,
  thread: [] as ChatMessage[],
  hold: false,
  release: () => {},
  setup: undefined as ProjectChat["setup"],
}));

vi.mock("./api", () => ({
  api: {
    onProjectChats: () => () => {},
    onProjectChat: (callback: (push: ProjectChatPush) => void) => {
      desktop.push = callback;
      desktop.subscriptions++;
      return () => {};
    },
    // Answers like ProjectChats.changes, from the thread as it is when called.
    projectChat: (id: string, known: KnownMessages = {}) => {
      const patch = {
        id,
        setup: structuredClone(desktop.setup),
        messages: desktop.thread.map((m) =>
          known[m.id] === m.version ? m.id : structuredClone(m),
        ),
      } as ProjectChatPatch;
      return new Promise((resolve) => {
        if (desktop.hold) desktop.release = () => resolve(patch);
        else resolve(patch);
      });
    },
  },
}));

const message = (
  id: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role: "assistant",
  body: "",
  status: "complete",
  created: 0,
  provider: "claude",
  version: 1,
  ...extra,
});

let qc: QueryClient;
const shown = () =>
  qc
    .getQueryData<ProjectChat>(chatKey("t"))
    ?.messages.map((m) => `${m.id}:${m.status}:${m.version}`);
const refetch = async () =>
  qc.setQueryData(chatKey("t"), await fetchChat(qc, "t"));

beforeEach(() => {
  qc = new QueryClient();
  desktop.hold = false;
  desktop.thread = [message("q", { role: "user" })];
  desktop.setup = undefined;
  followChatEvents(qc);
});

it("streams pushes into the cached thread and ignores older copies", async () => {
  await refetch();
  const answer = message("a", { status: "streaming" });
  desktop.thread.push(answer);
  desktop.push({ chatId: "t", message: { ...answer, version: 3 } });
  desktop.push({ chatId: "t", message: { ...answer, version: 2 } });
  expect(shown()).toEqual(["q:complete:1", "a:streaming:3"]);
});

it("drops the empty answer a steer replaced once the thread refetches", async () => {
  await refetch();
  const empty = message("a1", { status: "streaming" });
  desktop.thread.push(empty);
  desktop.push({ chatId: "t", message: structuredClone(empty) });
  // The agent read the steer before writing anything: the empty answer goes,
  // and the turn goes on in a new one below the steer.
  const steer = message("s", { role: "user" });
  const below = message("a2", { status: "streaming", version: 2 });
  desktop.thread = [desktop.thread[0], steer, below];
  desktop.push({ chatId: "t", message: structuredClone(below) });
  await refetch();
  expect(shown()).toEqual(["q:complete:1", "s:complete:1", "a2:streaming:2"]);
});

it("keeps a push that overtook a slower reply", async () => {
  await refetch();
  const answer = message("a", { status: "streaming" });
  desktop.thread.push(answer);
  desktop.hold = true;
  const fetching = fetchChat(qc, "t");
  desktop.push({ chatId: "t", message: { ...answer, version: 4 } });
  desktop.release();
  qc.setQueryData(chatKey("t"), await fetching);
  expect(shown()).toEqual(["q:complete:1", "a:streaming:4"]);
});

it("places a streaming answer's patches in the cached thread", async () => {
  await refetch();
  const desktopSide = new ChatPushSender<object>(structuredClone);
  const window = {};
  let answer = message("a", { status: "streaming" });
  desktop.thread.push(answer);
  const sent: ProjectChatPush[] = [];
  for (const body of ["One", "One two", "One two three"]) {
    answer = { ...answer, body, version: answer.version + 1 };
    for (const [, push] of desktopSide.pushes(
      { chatId: "t", message: answer },
      [window],
    ))
      sent.push(push);
  }
  for (const push of sent) desktop.push(structuredClone(push));
  expect(sent.filter((p) => "patch" in p)).toHaveLength(2);
  expect(qc.getQueryData<ProjectChat>(chatKey("t"))?.messages[1]).toEqual(
    answer,
  );
});

it("asks for whole answers again, once, when a patch builds on a copy it never got", () => {
  const subscriptions = desktop.subscriptions;
  const patch = (base: number): ProjectChatPush => ({
    chatId: "t",
    patch: { id: "a", body: { from: 3, text: " two" } },
    base,
  });
  desktop.push(patch(2));
  desktop.push(patch(3));
  expect(desktop.subscriptions).toBe(subscriptions + 1);
  expect(qc.getQueryData<ProjectChat>(chatKey("t"))).toBeUndefined();
});

const setup = (): NonNullable<ProjectChat["setup"]> => ({
  computer: "other-computer",
  after: 1,
  at: 1,
  state: "agent",
  project: "project",
  messages: [message("setup-answer", { status: "streaming" })],
});

it("ignores setup pushes older than the cached message", async () => {
  desktop.setup = setup();
  await refetch();
  desktop.push({
    chatId: "t",
    setup: true,
    message: message("setup-answer", { version: 3 }),
  });
  desktop.push({
    chatId: "t",
    setup: true,
    message: message("setup-answer", { version: 2 }),
  });
  expect(
    qc.getQueryData<ProjectChat>(chatKey("t"))?.setup?.messages[0].version,
  ).toBe(3);
});

it("keeps newer setup message versions without replacing fetched setup metadata", async () => {
  desktop.setup = setup();
  await refetch();
  desktop.setup.state = "done";
  desktop.hold = true;
  const fetching = fetchChat(qc, "t");
  desktop.push({
    chatId: "t",
    setup: true,
    message: message("setup-answer", { version: 2 }),
  });
  desktop.release();
  const fetched = await fetching;
  expect(fetched.setup?.state).toBe("done");
  expect(fetched.setup?.messages[0].version).toBe(2);
});

it.each(["removed", "new-at", "new-computer", "removed-message"] as const)(
  "does not resurrect setup data when the reply has %s",
  async (change) => {
    desktop.setup = setup();
    await refetch();
    if (change === "removed") desktop.setup = undefined;
    else if (change === "new-at") desktop.setup.at = 2;
    else if (change === "new-computer")
      desktop.setup.computer = "third-computer";
    else desktop.setup.messages = [];
    desktop.hold = true;
    const fetching = fetchChat(qc, "t");
    desktop.push({
      chatId: "t",
      setup: true,
      message: message("setup-answer", { version: 2 }),
    });
    desktop.release();
    const fetched = await fetching;
    expect(fetched.setup).toEqual(desktop.setup);
  },
);
