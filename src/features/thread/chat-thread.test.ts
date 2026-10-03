import { expect, it } from "vitest";
import { conversation, replyCounts, sideThreads } from "./chat-thread";
import { replyRoots, type ChatMessage } from "../../../shared/projects";

const message = (
  id: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role: "assistant",
  body: id,
  status: "complete",
  created: 0,
  provider: "claude",
  version: 1,
  ...extra,
});
const ids = (messages: ChatMessage[]) => messages.map((m) => m.id);

it("files replies to replies under the side question they started from", () => {
  const messages = [
    message("q", { side: true, created: 1 }),
    message("r1", { parentId: "q", created: 2, ended: 4 }),
    message("r2", { parentId: "r1", created: 6 }),
    message("r3", { parentId: "q", created: 7, status: "streaming" }),
    message("main", { created: 3 }),
  ];
  const roots = replyRoots(messages);
  expect(replyCounts(roots)).toEqual(new Map([["q", 3]]));
  // A streaming reply isn't counted yet; it shows as answering.
  expect(sideThreads(messages, roots).get("q")).toEqual({
    replies: 2,
    last: 6,
    answering: true,
  });
  expect(ids(conversation(messages, roots, undefined))).toEqual(["q", "main"]);
  expect(ids(conversation(messages, roots, "q"))).toEqual([
    "q",
    "r1",
    "r2",
    "r3",
  ]);
});

it("opens a reply chain whose first message is gone from what's left of it", () => {
  const messages = [
    message("b", { parentId: "gone" }),
    message("c", { parentId: "b" }),
  ];
  const roots = replyRoots(messages);
  expect(roots).toEqual(new Map([["c", "b"]]));
  expect(ids(conversation(messages, roots, undefined))).toEqual(["b"]);
  expect(ids(conversation(messages, roots, "b"))).toEqual(["b", "c"]);
});

it("keeps every reply of a chain whose start is gone under its first surviving message", () => {
  const messages = [
    message("a", { parentId: "gone", created: 1 }),
    message("b", { parentId: "a", created: 2 }),
    message("c", { parentId: "b", created: 3 }),
  ];
  const roots = replyRoots(messages);
  expect(roots).toEqual(
    new Map([
      ["b", "a"],
      ["c", "a"],
    ]),
  );
  expect(replyCounts(roots)).toEqual(new Map([["a", 2]]));
  expect(ids(conversation(messages, roots, undefined))).toEqual(["a"]);
  expect(ids(conversation(messages, roots, "a"))).toEqual(["a", "b", "c"]);
});
