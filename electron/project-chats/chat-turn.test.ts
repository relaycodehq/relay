import { it, expect } from "vitest";
import type { ChatMessage } from "../../shared/projects";
import { agentJob, turnRules, type ChatTurn } from "./chat-turn";

const answer = (extra: Partial<ChatMessage> = {}) =>
  ({
    id: "a",
    role: "assistant",
    status: "streaming",
    ...extra,
  }) as ChatMessage;

it("plans a resume after a usage limit only for turns that carry on the user's answer", () => {
  expect(turnRules({ kind: "reply" }).plansResume).toBe(true);
  // Reattached after a restart, carrying on the answer it was writing.
  expect(turnRules({ kind: "adopt", resumed: answer() }).plansResume).toBe(
    true,
  );
  expect(
    turnRules({ kind: "adopt", resumed: answer({ unprompted: true }) })
      .plansResume,
  ).toBe(false);
  expect(turnRules({ kind: "adopt" }).plansResume).toBe(false);
  expect(turnRules({ kind: "handoff" }).plansResume).toBe(false);
  expect(turnRules({ kind: "side" }).plansResume).toBe(false);
  expect(turnRules({ kind: "compact" }).plansResume).toBe(false);
});

it("lets the queue go on past a failed compaction Relay started for a cold cache, not a stopped one", () => {
  const compact = turnRules({ kind: "compact" });
  expect(compact.pausesQueue(answer({ status: "failed" }))).toBe(true);
  expect(
    compact.pausesQueue(answer({ status: "failed", compactedCold: true })),
  ).toBe(false);
  expect(
    compact.pausesQueue(answer({ status: "cancelled", compactedCold: true })),
  ).toBe(true);
});

it("runs each turn kind as its job, and a reviewer's Codex review only for its task", () => {
  const kinds: ChatTurn[] = [
    { kind: "reply", request: "/review" },
    { kind: "handoff" },
    { kind: "side" },
    { kind: "compact" },
    { kind: "adopt" },
  ];
  const reviewer = { parent: "p", slot: 0 };
  const target = { type: "uncommittedChanges" } as const;
  const jobs = (chat: Parameters<typeof agentJob>[1]) =>
    kinds.map((turn) => agentJob(turn, chat).kind);
  expect(jobs({})).toEqual(["prompt", "prompt", "side", "compact", "adopt"]);
  // A reviewer without Codex's own review sends its prompt like any thread.
  expect(jobs({ reviewer })).toEqual(jobs({}));
  const codex = { reviewer: { ...reviewer, codex: target } };
  expect(jobs(codex)).toEqual(["review", "prompt", "side", "compact", "adopt"]);
  expect(agentJob({ kind: "reply", request: "/review" }, codex)).toEqual({
    kind: "review",
    target,
  });
  // A steer or a follow-up in its thread is answered, not reviewed again.
  for (const request of ["Look at the queue too.", "Continue", undefined])
    expect(agentJob({ kind: "reply", request }, codex).kind).toBe("prompt");
});
