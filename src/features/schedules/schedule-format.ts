import { formatDate } from "../../../shared/date-format";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** "Fri 30 Oct, 9:00". */
export const runTime = (at: number) =>
  `${formatDate(at, { weekday: "short", day: "numeric", month: "short" })}, ${formatDate(at, { hour: "numeric", minute: "2-digit" })}`;

/** "6 Nov". */
export const dayMonth = (at: number) =>
  formatDate(at, { day: "numeric", month: "short" });

/** "in 20min", "in 5h", "tomorrow", "in 6 days". */
export function fromNow(at: number, now = Date.now()) {
  const minutes = Math.round((at - now) / MINUTE);
  if (minutes < 60) return `in ${Math.max(minutes, 1)}min`;
  if (minutes < 18 * 60) return `in ${Math.round(minutes / 60)}h`;
  const days = Math.round(
    (new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY,
  );
  return days <= 1 ? "tomorrow" : `in ${days} days`;
}

/** "38k". */
export const tokenCount = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
