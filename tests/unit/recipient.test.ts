import { expect, it } from "vitest";
import { agentAsked, recipient, sentAgent } from "../../shared/recipient";

it("reads who answers a message from before `to` off its leading mention", () => {
  // An older phone typed @claude on a Codex composer: Claude answers, as ever.
  const legacy = { body: " @claude look at this ", provider: "codex" as const };
  expect(recipient(legacy)).toBe("claude");
  expect(agentAsked(legacy)).toEqual({
    provider: "claude",
    question: "look at this",
  });
  expect(sentAgent(legacy)).toBe("claude");
  // No mention, or one that isn't leading, is a note.
  const note = { body: "remember @codex later", provider: "codex" as const };
  expect(recipient(note)).toBe("message");
  expect(agentAsked(note)).toBeNull();
  expect(sentAgent(note)).toBe("codex");
});

it("lets `to` decide over whatever the body starts with", () => {
  expect(recipient({ body: "@codex not for you", to: "message" })).toBe(
    "message",
  );
  expect(agentAsked({ body: "@codex look", to: "claude" })).toEqual({
    provider: "claude",
    question: "look",
  });
  expect(agentAsked({ body: "look", to: "cursor" })).toEqual({
    provider: "cursor",
    question: "look",
  });
});
