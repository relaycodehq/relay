import { it, expect } from "vitest";
import type { ChatMessage } from "../../shared/projects";
import { turnRules } from "./chat-turn";

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
