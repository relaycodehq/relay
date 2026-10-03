export function formatTokens(value: number) {
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
