import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type {
  ChatMessage,
  KnownMessages,
  ProjectChat,
  ProjectChatPatch,
} from "../../shared/projects";
import type { ProjectChatEvent } from "../../shared/events";
import { chatKey, fetchChat, followChatEvents } from "./chat-events";

const desktop = vi.hoisted(() => ({
  push: (_: ProjectChatEvent) => {},
  thread: [] as ChatMessage[],
  hold: false,
  release: () => {},
}));
vi.mock("./api", () => ({
  api: {
    onProjectChats: () => () => {},
    onProjectChat: (callback: (e: ProjectChatEvent) => void) => {
      desktop.push = callback;
      return () => {};
    },
    // Answers like ProjectChats.changes, from the thread as it is when called.
    projectChat: (id: string, known: KnownMessages = {}) => {
      const patch = {
        id,
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
