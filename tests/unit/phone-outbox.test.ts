import { expect, it } from "vitest";
import {
  heldIds,
  outgoingMessage,
  settled,
  stamp,
  type Outgoing,
} from "../../mobile/src/remote/outbox-state";
import type { ChatMessage } from "../../shared/projects";

const chatId = "chat-1";
const outgoing = (id: string, extra: Partial<Outgoing> = {}): Outgoing => ({
  computer: "mac",
  chatId,
  send: {
    id,
    body: `@codex ${id}`,
    provider: "codex",
    choice: { model: "gpt-5.5", fast: false, reasoningEffort: "high" },
    runtimeMode: "full-access",
    interactionMode: "default",
  },
  created: 1,
  ...extra,
});
const message = (id: string): ChatMessage => ({
  id,
  role: "user",
  body: id,
  status: "complete",
  created: 1,
  provider: "codex",
  version: 1,
});
const queued = (id: string) => ({ id, body: id });

it("lets go of a quick second send the desktop queued instead of showing it twice", () => {
  // Sent while the phone still thought the thread idle; the desktop queued it behind the first.
  const first = outgoing("first", { sent: stamp() });
  const second = outgoing("second", { sent: stamp() });
  const fetched = stamp();
  const thread = { messages: [message("first")], queue: [queued("second")], scheduled: [] };
  expect(settled([first, second], chatId, heldIds(thread), fetched)).toEqual([first, second]);
});

it("lets go of one sent with Send later once the thread lists it", () => {
  const later = outgoing("later");
  const thread = { messages: [], queue: [], scheduled: [{ ...queued("later"), at: 9 }] };
  expect(settled([later], chatId, heldIds(thread), 0)).toEqual([later]);
});

it("lets go of a send taken back out of the queue before the phone saw it there", () => {
  const taken = outgoing("taken", { sent: stamp() });
  const fetched = stamp();
  expect(settled([taken], chatId, heldIds({ messages: [] }), fetched)).toEqual([taken]);
});

it("keeps a send the fetch began before the desktop took it, and those still failing", () => {
  const fetched = stamp();
  const late = outgoing("late", { sent: stamp() });
  const failed = outgoing("failed", { error: "Not connected to Mac." });
  const elsewhere = outgoing("elsewhere", { chatId: "chat-2", sent: 1 });
  const going = outgoing("going");
  expect(
    settled([late, failed, elsewhere, going], chatId, heldIds({ messages: [] }), fetched + 10),
  ).toEqual([late]);
  expect(settled([late, failed, elsewhere, going], chatId, heldIds({ messages: [] }), fetched)).toEqual(
    [],
  );
});

it("reads ids from a patch that only names the messages the phone holds", () => {
  expect([...heldIds({ messages: ["a", message("b")], queue: [queued("c")] })]).toEqual([
    "a",
    "b",
    "c",
  ]);
});

it("says a send that got no answer may have gone out", () => {
  expect(outgoingMessage(outgoing("x", { error: "Mac didn't answer in time." })).error).toBe(
    "Not sent: Mac didn't answer in time.",
  );
  expect(
    outgoingMessage(outgoing("x", { error: "Mac didn't answer in time.", unsure: true })).error,
  ).toBe("Maybe not sent: Mac didn't answer in time.");
});
