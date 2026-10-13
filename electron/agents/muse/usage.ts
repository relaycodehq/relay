import type { ProviderUsage, UsageWindow } from "../../../shared/provider-usage";
import { SESSION_MS, WEEK_MS } from "../../../shared/provider-usage";
import { withCatalog } from "./catalog";
import { subscriptionUsageSchema, type MuseSubscriptionUsage } from "./protocol";
import { signedIn } from "./sessions";

/**
 * Muse learns the plan's limits from the model calls it makes, so the newest
 * reading is whichever process saw one last: a thread's turn, or the catalog's.
 */
let latest: MuseSubscriptionUsage | undefined;

/** A `usage/changed` a turn heard. */
export function museUsageSeen(raw: unknown) {
  const usage = subscriptionUsageSchema.safeParse(raw);
  if (usage.success && (!latest || newer(usage.data, latest))) latest = usage.data;
}

const newer = (a: MuseSubscriptionUsage, b: MuseSubscriptionUsage) =>
  ((a as { observedAtMs?: number }).observedAtMs ?? 0) >=
  ((b as { observedAtMs?: number }).observedAtMs ?? 0);

const percent = (value: number) => Math.min(100, Math.max(0, value));

export function museWindows(usage: MuseSubscriptionUsage): UsageWindow[] {
  const { window, weekly } = usage;
  return [
    {
      kind: "session",
      usedPercent: percent(window.usedPercent),
      resetsAt: window.resetsAtMs,
      periodMs: window.windowDurationMins ? window.windowDurationMins * 60_000 : SESSION_MS,
    },
    ...(weekly
      ? [
          {
            kind: "weekly" as const,
            usedPercent: percent(weekly.usedPercent),
            resetsAt: weekly.resetsAtMs,
            periodMs: WEEK_MS,
          },
        ]
      : []),
  ];
}

/** The plan's limits, for the usage ring. */
export async function readMuseUsage(): Promise<ProviderUsage> {
  const read = await withCatalog((agent) =>
    signedIn(() => agent.connection.request<{ usage?: unknown }>("usage/read", {})),
  ).catch((error: Error) => (/signed out/i.test(error.message) ? "signedOut" : undefined));
  if (read === "signedOut")
    return { provider: "muse", windows: [], message: "Sign in with muse" };
  museUsageSeen(read?.usage);
  return latest
    ? { provider: "muse", windows: museWindows(latest), message: null }
    : // Muse hasn't made a model call since it started, so it can't tell yet.
      { provider: "muse", windows: [], message: "Shows after the first Muse answer" };
}
