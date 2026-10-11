import type { ChatMessage, ContextUsage } from "./projects";

/**
 * The newest reported usage on this branch, unless a compaction reset it
 * since or another agent took over: a new agent starts its own session, so
 * the old one's usage says nothing about it until it reports.
 */
export function latestContext(
  messages: ChatMessage[],
): { usage: ContextUsage; provider: ChatMessage["provider"] } | undefined {
  let holder: ChatMessage["provider"] | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant" || m.reload || m.worktreeCommand) continue;
    if (m.handoff) return;
    holder ??= m.provider;
    if (m.provider !== holder) return;
    if (m.context) return { usage: m.context, provider: m.provider };
    if (m.compaction && m.status === "complete") return;
  }
}
