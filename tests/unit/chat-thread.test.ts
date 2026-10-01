import { expect, it } from "vitest";
import {
  conversation,
  replyCounts,
  replyRoots,
  sideThreads,
  withUpdates,
} from "../../src/lib/chat-thread";
import type { ChatMessage } from "../../shared/projects";

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

it("keeps the newer of a fetched and a streamed copy, unsequenced last", () => {
  const merged = withUpdates(
    [
      message("b", { seq: 2, version: 3, body: "fetched" }),
      message("a", { seq: 1, version: 1, body: "fetched" }),
    ],
    {
      a: message("a", { seq: 1, version: 2, body: "streamed" }),
      b: message("b", { seq: 2, version: 2, body: "stale" }),
      // Just sent: no seq yet, so it goes after everything the thread ordered.
      d: message("d", { created: 5 }),
      c: message("c", { created: 1 }),
    },
  );
  expect(ids(merged)).toEqual(["a", "b", "c", "d"]);
  expect(merged.map((m) => m.body)).toEqual(["streamed", "fetched", "c", "d"]);
});

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
  expect(roots).toEqual(
    new Map([
      ["b", "gone"],
      ["c", "b"],
    ]),
  );
  expect(ids(conversation(messages, roots, undefined))).toEqual(["b"]);
  expect(ids(conversation(messages, roots, "b"))).toEqual(["b", "c"]);
});
