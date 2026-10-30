// A read-only turn's tool calls: a reviewer's, or a side conversation's,
// which keeps every tool its thread has so its fork reads the thread's cache.
// Allow rules in the user's settings approve a call before canUseTool can turn
// it down, so the line is drawn in a PreToolUse hook, which runs first.
import { RELAY_SERVER, relayToolsWhere } from "../relay-mcp";
import { readOnlyBashHook } from "./read-only-bash";

const writes = new Set([
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  // Claude Code's own worktrees move the session where Relay can't follow.
  "EnterWorktree",
  "ExitWorktree",
]);

/** Relay's tools that only read or wait; the others act as the thread. */
const relayReads = relayToolsWhere((t) => t.replayable);

const deny = (reason: string) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse" as const,
    permissionDecision: "deny" as const,
    permissionDecisionReason: reason,
  },
});

/** The PreToolUse hook: anything that could change something is turned down. */
export async function readOnlyHook(input: unknown) {
  const { tool_name: tool = "" } = (input ?? {}) as { tool_name?: string };
  if (tool === "Bash") return readOnlyBashHook(input);
  if (writes.has(tool))
    return deny(
      "This thread only reads. Report what should change instead of changing files.",
    );
  if (!tool.startsWith("mcp__")) return {};
  const relayTool = tool.startsWith(`mcp__${RELAY_SERVER}__`)
    ? tool.slice(`mcp__${RELAY_SERVER}__`.length)
    : undefined;
  if (relayTool && relayReads.has(relayTool)) return {};
  return deny(
    "This thread only reads, and this tool could act. Say what you'd do with it instead.",
  );
}
