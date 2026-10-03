import { reportsUsage, type AgentProvider } from "../../shared/agents";
import { readProviderUsage } from "./provider-usage";

/** Agents report reset times in seconds or milliseconds; Relay keeps ms. */
export function resetMs(at: number | null | undefined): number | undefined {
  if (at == null || !Number.isFinite(at) || at <= 0) return;
  return at < 1e12 ? at * 1000 : at;
}

/** With several windows spent, the last to lift: the earlier ones still leave it blocked. */
export function latestReset(times: (number | null | undefined)[]) {
  const known = times.filter((t): t is number => t != null);
  return known.length ? Math.max(...known) : undefined;
}

/** When the account's spent window lifts, read fresh from its usage meters. */
export async function usageResetsAt(
  provider: AgentProvider,
  account?: string,
): Promise<number | undefined> {
  if (!reportsUsage(provider)) return;
  const { windows } = await readProviderUsage(provider, true, account);
  return latestReset(
    windows.filter((w) => w.usedPercent >= 99.5).map((w) => w.resetsAt),
  );
}
