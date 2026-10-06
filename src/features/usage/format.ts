import { agentProviders } from "../../../shared/agents";
import type { UsageDay } from "../../../shared/usage";

/** 1.2K, 34M, 2.1B. */
export function compact(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return `${Math.round(n)}`;
}

export function usd(n: number) {
  return n >= 100
    ? `$${Math.round(n).toLocaleString("en-US")}`
    : `$${n.toFixed(2)}`;
}

export function dayLabel(at: number) {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function longDay(at: number) {
  return new Date(at).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Hours with one decimal under ten, whole above. */
export function hours(ms: number) {
  const h = ms / 3_600_000;
  return h < 10
    ? `${h.toFixed(1)} h`
    : `${Math.round(h).toLocaleString("en-US")} h`;
}

export const dayTotal = (d: UsageDay) =>
  agentProviders.reduce((n, p) => n + d.tokens[p], 0);

/** A column of the daily chart: a day, or a week once there are too many days to draw. */
export type UsageColumn = UsageDay & { last: number };

export function columnsOf(days: UsageDay[], most = 92): UsageColumn[] {
  if (days.length <= most) return days.map((d) => ({ ...d, last: d.day }));
  const columns: UsageColumn[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    const column: UsageColumn = {
      day: week[0].day,
      last: week[week.length - 1].day,
      tokens: { ...week[0].tokens },
      usd: { ...week[0].usd },
      answers: week[0].answers,
    };
    for (const d of week.slice(1)) {
      column.answers += d.answers;
      for (const p of agentProviders) {
        column.tokens[p] += d.tokens[p];
        column.usd[p] += d.usd[p];
      }
    }
    columns.push(column);
  }
  return columns;
}
