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

/**
 * Past this, a message that finds the prompt cache cold compacts first. The
 * agent reads the whole context again either way; compacting adds a summary
 * and then every request carries far less. Tokens rather than a share of the
 * window, since what a cold read costs grows with the tokens alone.
 */
export const COLD_COMPACT_TOKENS = 120_000;

/** The conversation is big enough, and its cache cold, to compact before the next message. */
export function compactsCold(usage: ContextUsage, now: number) {
  return (
    !!usage.cache &&
    now >= usage.cache.at + usage.cache.ttlMs &&
    usage.usedTokens >= COLD_COMPACT_TOKENS
  );
}
