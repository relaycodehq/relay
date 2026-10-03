import { expect, it } from "vitest";
import {
  applyMessage,
  applyPatch,
  keepNewer,
  mainMessages,
  MissingMessage,
  type Thread,
} from "../../mobile/src/remote/chat-state";
import type { ChatMessage } from "../../shared/projects";
import type { RemoteChat } from "../../shared/remote";

const message = (
  id: string,
  body: string,
  version: number,
  seq?: number,
): ChatMessage => ({
  id,
  role: "assistant",
  body,
  status: "streaming",
  created: seq ?? 0,
  provider: "codex",
  version,
  ...(seq ? { seq } : {}),
});
const chat = (messages: RemoteChat["messages"]): RemoteChat => ({
  id: "c",
  projectId: "p",
  title: "T",
  scope: { kind: "project" },
  messages,
  running: true,
  root: "/r",
  earlier: 0,
  queue: [],
  scheduled: [],
});

it("fills messages the desktop only named from the ones the phone holds", () => {
  const first = applyPatch(undefined, chat([message("a", "Hi", 1, 1)]));
  const next = applyPatch(first, chat(["a", message("b", "More", 1, 2)]));
  expect(next.messages.map((m) => m.body)).toEqual(["Hi", "More"]);
  expect(next.messages[0]).toBe(first.messages[0]);
  // The phone lost that copy: the caller fetches the whole thread instead.
  expect(() => applyPatch(undefined, chat(["a"]))).toThrow(MissingMessage);
});

it("keeps the newest version when a stream and a fetch cross", () => {
  let thread: Thread = applyPatch(undefined, chat([message("a", "He", 2, 1)]));
  thread = applyMessage(thread, message("a", "Hello", 5, 1));
  // A late event with an older version changes nothing.
  expect(applyMessage(thread, message("a", "Hel", 3, 1))).toBe(thread);
  // A fetch that started before the stream moved on doesn't roll it back.
  const fetched = applyPatch(undefined, chat([message("a", "Hel", 3, 1)]));
  expect(keepNewer(fetched, thread).messages[0]!.body).toBe("Hello");
});

it("places a new message in thread order", () => {
  const thread = applyPatch(
    undefined,
    chat([message("a", "1", 1, 1), message("c", "3", 1, 3)]),
  );
  expect(
    applyMessage(thread, message("b", "2", 1, 2)).messages.map((m) => m.body),
  ).toEqual(["1", "2", "3"]);
});

it("keeps replies whose root fell out of the window in the main list", () => {
  const reply = (id: string, parentId: string): ChatMessage => ({
    ...message(id, id, 1),
    parentId,
  });
  const messages = [
    message("q", "q", 1),
    reply("a", "gone"),
    reply("b", "a"),
    reply("c", "b"),
    reply("r", "q"),
  ];
  expect(mainMessages(messages).map((m) => m.id)).toEqual(["q", "a"]);
});
