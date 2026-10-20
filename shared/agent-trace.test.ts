import { expect, it } from "vitest";
import { readTurn } from "./agent-trace";
import type { AgentTrace, ChatMessage } from "./projects";

const call = (id: string, parentId?: string): AgentTrace => ({
  kind: "activity",
  id,
  activity: { id, parentId, kind: "command", label: id, status: "complete" },
});

function message(trace: AgentTrace[]): ChatMessage {
  for (const entry of trace) {
    if (entry.kind === "activity") Object.freeze(entry.activity);
    Object.freeze(entry);
  }
  Object.freeze(trace);
  return Object.freeze({
    id: "answer",
    role: "assistant",
    provider: "claude",
    status: "complete",
    body: "Done.",
    created: 1,
    version: 1,
    trace,
  });
}

it("keeps nested calls in order, including calls before their parent, and leaves orphans visible", () => {
  const turn = readTurn(
    message([
      { kind: "commentary", id: "note", text: "Checking both paths." },
      call("first-a", "agent-a"),
      call("agent-a"),
      call("agent-b"),
      call("first-b", "agent-b"),
      call("grandchild", "first-a"),
      call("second-a", "agent-a"),
      call("orphan", "dropped-parent"),
    ]),
  );
  expect(turn.shown.map((entry) => entry.id)).toEqual([
    "note",
    "agent-a",
    "agent-b",
    "orphan",
  ]);
  expect(turn.activity.map((activity) => activity.id)).toEqual([
    "agent-a",
    "agent-b",
    "orphan",
  ]);
  expect(
    [...turn.calls].map(([parent, calls]) => [
      parent,
      calls.map((activity) => activity.id),
    ]),
  ).toEqual([
    ["agent-a", ["first-a", "second-a"]],
    ["agent-b", ["first-b"]],
    ["first-a", ["grandchild"]],
  ]);
});

it("groups a long trace without mutating the message or sharing arrays between reads", () => {
  const children = Array.from({ length: 2000 }, (_, i) =>
    call(`call-${i}`, "agent"),
  );
  const saved = message([call("agent"), ...children]);
  const first = readTurn(saved);
  const second = readTurn(saved);
  const ids = children.map((entry) => entry.id);
  expect(first.shown.map((entry) => entry.id)).toEqual(["agent"]);
  expect(first.calls.get("agent")!.map((activity) => activity.id)).toEqual(ids);
  expect(second.calls.get("agent")).not.toBe(first.calls.get("agent"));
  first.calls.get("agent")!.pop();
  expect(second.calls.get("agent")!.map((activity) => activity.id)).toEqual(
    ids,
  );
  expect(saved.trace).toHaveLength(2001);
});
