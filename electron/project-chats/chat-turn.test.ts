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

it("runs each turn kind as its job, a compaction or picked-up turn over a reviewer's Codex review", () => {
  const kinds: ChatTurn[] = [
    { kind: "reply" },
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
  expect(jobs({ reviewer: { ...reviewer, codex: target } })).toEqual([
    "review",
    "review",
    "review",
    "compact",
    "adopt",
  ]);
  expect(
    agentJob({ kind: "reply" }, { reviewer: { ...reviewer, codex: target } }),
  ).toEqual({ kind: "review", target });
});
