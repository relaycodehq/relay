import { it, expect } from "vitest";
import { migrateAgentSessions, type ProjectChat } from "../../shared/projects";

it("moves sessions saved before the agent registry into per-agent slots", () => {
  const chat = {
    id: "c",
    claudeThread: "claude-main",
    claudeThrough: "m2",
    providerThread: "codex-main",
    providerThrough: "m1",
    replySessions: {
      side: {
        thread: "codex-side",
        through: "m5",
        claudeThread: "claude-side",
      },
      // Already migrated: left as it is.
      other: { opencode: { thread: "ses_1", through: "m9" } },
    },
  } as unknown as ProjectChat;
  expect(migrateAgentSessions(chat)).toBe(true);
  expect(chat).toEqual({
    id: "c",
    sessions: {
      claude: { thread: "claude-main", through: "m2" },
      codex: { thread: "codex-main", through: "m1" },
    },
    replySessions: {
      side: {
        claude: { thread: "claude-side" },
        codex: { thread: "codex-side", through: "m5" },
      },
      other: { opencode: { thread: "ses_1", through: "m9" } },
    },
  });
  // A second load finds nothing left to move.
  expect(migrateAgentSessions(chat)).toBe(false);
});

it("keeps a chat that never had a session free of empty slots", () => {
  const chat = { id: "c", providerThread: undefined } as unknown as ProjectChat;
  migrateAgentSessions(chat);
  expect(chat).toEqual({ id: "c" });
});
