import { reportsUsage, type AgentProvider } from "../../shared/agents";
import { readProviderUsage } from "./provider-usage";

/** The agent's plan ran out; `resetsAt` (ms) is when it lifts, if the agent said. */
export class UsageLimitError extends Error {
  constructor(
    readonly provider: AgentProvider,
    message: string,
    readonly resetsAt?: number,
  ) {
    super(message);
    this.name = "UsageLimitError";
  }
}

/** Agents report reset times in seconds or milliseconds; Relay keeps ms. */
export function resetMs(at: unknown): number | undefined {
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return;
  return at < 1e12 ? at * 1000 : at;
}

/** When the spent windows of a Codex `account/rateLimits/updated` snapshot lift. */
export function codexSpentUntil(limits: unknown): number | undefined {
  const snapshot = limits as Record<string, any> | null | undefined;
  return latest(
    [snapshot?.primary, snapshot?.secondary]
      .filter((w) => typeof w?.usedPercent === "number" && w.usedPercent >= 100)
      .map((w) => resetMs(w.resetsAt)),
  );
}

/** When the provider's spent window lifts, read fresh from its usage meters. */
export async function usageResetsAt(
  provider: AgentProvider,
): Promise<number | undefined> {
  if (!reportsUsage(provider)) return;
  const { windows } = await readProviderUsage(provider, true);
  return latest(
    windows.filter((w) => w.usedPercent >= 99.5).map((w) => w.resetsAt),
  );
}

/** With several windows spent, the last to lift: the earlier ones still leave it blocked. */
function latest(times: (number | null | undefined)[]) {
  const known = times.filter((t): t is number => t != null);
  return known.length ? Math.max(...known) : undefined;
}
