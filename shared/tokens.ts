export function formatTokens(value: number) {
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** "281k → 8.9k tokens", or as much of it as the agent reported. */
export function compactedTokens(
  before: number | undefined,
  after: number | undefined,
) {
  // A reading taken during the compaction itself is no smaller than before.
  if (after && before && after >= before) after = undefined;
  if (before && after)
    return `${formatTokens(before)} → ${formatTokens(after)} tokens`;
  if (before) return `from ${formatTokens(before)} tokens`;
  if (after) return `to ${formatTokens(after)} tokens`;
  return "";
}
