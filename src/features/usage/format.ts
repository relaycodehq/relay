import {
  providersIn,
  type UsageDay,
  type UsageMeasure,
} from "../../../shared/usage";

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

/** Dollars or fresh tokens, written the way the page writes that measure. */
export const measured = (n: number, m: UsageMeasure) =>
  m === "usd" ? usd(n) : compact(n);

export const dayTotal = (d: UsageDay, m: UsageMeasure) =>
  providersIn(d[m]).reduce((n, p) => n + (d[m][p] ?? 0), 0);

/** "19:00"; 24 reads as midnight again. */
export const clock = (hour: number) =>
  `${String(hour % 24).padStart(2, "0")}:00`;

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
      fresh: { ...week[0].fresh },
      usd: { ...week[0].usd },
      answers: week[0].answers,
    };
    for (const d of week.slice(1)) {
      column.answers += d.answers;
      for (const p of providersIn(d.fresh)) {
        column.fresh[p] = (column.fresh[p] ?? 0) + (d.fresh[p] ?? 0);
        column.usd[p] = (column.usd[p] ?? 0) + (d.usd[p] ?? 0);
      }
    }
    columns.push(column);
  }
  return columns;
}
