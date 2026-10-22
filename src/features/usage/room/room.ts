// "Room left now": each signed-in account's limits as columns, the one with
// the most room lit, and Codex's saved resets under them. The words and picks
// live here; RoomLeft draws them.
import { agentName } from "../../../../shared/agents";
import type {
  AccountProvider,
  AgentAccount,
} from "../../../../shared/agent-accounts";
import {
  presentWindow,
  SESSION_MS,
  WEEK_MS,
  type ProviderUsage,
  type SavedResets,
  type UsageMeter,
  type UsageWindow,
} from "../../../../shared/provider-usage";
import { dayLabel } from "../format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Under this much left on any limit, a saved reset is worth offering loudly. */
const LOW_PERCENT = 20;

export type RoomTank = { window: UsageWindow; meter: UsageMeter };
export type RoomAccount = {
  provider: AccountProvider;
  id: string;
  name: string;
  /** Shortest limit first. */
  tanks: RoomTank[];
  resets: SavedResets | null;
};

/** Signed-in accounts that report limits, in Settings' order. */
export function roomAccounts(
  accounts: readonly AgentAccount[],
  usageOf: (provider: AccountProvider, id: string) => ProviderUsage | undefined,
  now: number,
): RoomAccount[] {
  const signedIn = accounts.filter((a) => a.signedIn);
  return signedIn.flatMap((a) => {
    const usage = usageOf(a.provider, a.id);
    if (!usage?.windows.length) return [];
    // One account per agent goes by the agent's name; "Default" says nothing.
    const several =
      signedIn.filter((b) => b.provider === a.provider).length > 1;
    return [
      {
        provider: a.provider,
        id: a.id,
        name: several ? a.label : agentName(a.provider),
        tanks: [...usage.windows]
          .sort((x, y) => x.periodMs - y.periodMs)
          .map((window) => ({
            window,
            meter: presentWindow(window, now, usage.activeHours),
          })),
        resets: usage.resets ?? null,
      },
    ];
  });
}

const near = (a: number, b: number, slack: number) => Math.abs(a - b) <= slack;

/** The column's label: "5h", "Week", "Month". */
export function windowName(periodMs: number) {
  if (near(periodMs, SESSION_MS, MINUTE)) return "5h";
  if (near(periodMs, WEEK_MS, HOUR)) return "Week";
  const days = Math.round(periodMs / DAY);
  if (days >= 28 && days <= 31) return "Month";
  return days >= 1 ? `${days}d` : `${Math.round(periodMs / HOUR)}h`;
}

/** The same, written out for the readout: "5 hours". */
export function windowTitle(periodMs: number) {
  const short = windowName(periodMs);
  if (short === "5h") return "5 hours";
  if (/^\d+d$/.test(short)) return `${parseInt(short)} days`;
  if (/^\d+h$/.test(short)) return `${parseInt(short)} hours`;
  return short;
}

/** What's left before any of its limits stops the account. */
export const leftOf = (a: RoomAccount) =>
  Math.min(...a.tanks.map((t) => t.meter.leftPercent));

/** The account with the most room; the first of a tie. */
export function roomiest(accounts: readonly RoomAccount[]) {
  return accounts.reduce<RoomAccount | undefined>(
    (best, a) => (!best || leftOf(a) > leftOf(best) ? a : best),
    undefined,
  );
}

export const isLow = (a: RoomAccount) => leftOf(a) < LOW_PERCENT;

const time = (at: number) =>
  new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

/** "18:00" today, "Sun 17:20" this week, "Oct 31" further out. */
export function when(at: number, now: number) {
  if (new Date(at).toDateString() === new Date(now).toDateString())
    return time(at);
  if (at - now < 6 * DAY)
    return `${new Date(at).toLocaleDateString("en-US", { weekday: "short" })} ${time(at)}`;
  return dayLabel(at);
}

/** The hover readout for one column. */
export function tankWords(t: RoomTank, now: number) {
  const { leftPercent, limitLabel } = t.meter;
  const at = t.window.resetsAt;
  return {
    title: t.window.label ?? windowTitle(t.window.periodMs),
    left: `${leftPercent}% left`,
    end:
      at == null
        ? null
        : leftPercent === 0
          ? `back at ${when(at, now)}`
          : `resets ${when(at, now)}`,
    // "Out in ~7h" → "runs out in ~7h at this pace".
    pace: limitLabel?.startsWith("Out")
      ? `${limitLabel.replace(/^Out/, "runs out")} at this pace`
      : null,
  };
}
