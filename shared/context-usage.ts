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

/**
 * When Relay compacts a big conversation without being asked: while it
 * waits, just before its cache expires, and before a message that finds it
 * cold. Saved for every thread; unset is both off.
 */
export interface AutoCompact {
  idle: boolean;
  cold: boolean;
}
export const defaultAutoCompact: AutoCompact = { idle: false, cold: false };

/** The conversation is big enough, and its cache cold, to compact before the next message. */
export function worthCompactingCold(usage: ContextUsage, now: number) {
  return (
    !!usage.cache &&
    now >= usage.cache.at + usage.cache.ttlMs &&
    usage.usedTokens >= COLD_COMPACT_TOKENS
  );
}

/**
 * How long before its cache expires an idle conversation compacts, so the
 * compaction itself still reads the context from the cache.
 */
export const IDLE_COMPACT_LEAD_MS = 5 * 60_000;
/** A cache this short would compact a thread the moment you looked away. */
const IDLE_COMPACT_MIN_TTL_MS = 20 * 60_000;

/**
 * When a conversation this big compacts while idle, before its cache goes
 * cold; undefined when it is too small, its cache too short-lived or already
 * cold, or its newest answer is a compaction.
 */
export function idleCompactAt(
  messages: ChatMessage[],
  now: number,
): number | undefined {
  const held = latestContext(messages);
  const newest = messages
    .filter(
      (m) =>
        m.role === "assistant" && !m.side && !m.reload && !m.worktreeCommand,
    )
    .at(-1);
  const cache = held?.usage.cache;
  if (
    !held ||
    !cache ||
    newest?.compaction ||
    newest?.provider !== held.provider ||
    cache.ttlMs < IDLE_COMPACT_MIN_TTL_MS ||
    held.usage.usedTokens < COLD_COMPACT_TOKENS ||
    now >= cache.at + cache.ttlMs - 60_000
  )
    return undefined;
  return cache.at + cache.ttlMs - IDLE_COMPACT_LEAD_MS;
}
