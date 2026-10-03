import { expect, it } from "vitest";
import type { ChatMessage } from "./projects";
import {
  agentAsked,
  contextAgent,
  recipient,
  sentAgent,
  takesOver,
} from "./recipient";

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

const message = (
  provider: ChatMessage["provider"],
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "assistant",
  body: "",
  status: "complete",
  created: 1,
  provider,
  version: 1,
  ...extra,
});

it("finds the agent holding the context past compactions, handoff notes and a side root", () => {
  const root = message("codex");
  expect(
    contextAgent([
      message("codex"),
      message("claude"),
      message("cursor", { status: "failed" }),
      message("codex", { compaction: true }),
      message("opencode", { handoff: { from: "opencode", to: "claude" } }),
      message("claude", { role: "user" }),
    ]),
  ).toBe("cursor");
  // A side conversation counts only its own answers.
  expect(contextAgent([root], root.id)).toBeUndefined();
  expect(contextAgent([root, message("claude")], root.id)).toBe("claude");
});

it("takes over only when another agent is asked while one holds the context", () => {
  expect(takesOver("claude", "codex")).toBe(true);
  expect(takesOver("codex", "codex")).toBe(false);
  expect(takesOver("message", "codex")).toBe(false);
  expect(takesOver("claude", undefined)).toBe(false);
  expect(takesOver(undefined, "codex")).toBe(false);
});
