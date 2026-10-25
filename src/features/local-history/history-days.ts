import type {
  LocalHistoryEntry,
  LocalHistoryReason,
} from "../../../shared/local-history";
import { formatDate } from "../../../shared/date-format";

/** Why a version was kept, as the list says it. */
export const reasonText: Record<LocalHistoryReason, string> = {
  save: "Saved",
  external: "Changed outside Relay",
  agent: "Agent edit",
  "before-revert": "Before revert",
  label: "Label",
};

export interface DayGroup {
  /** "Today", "Yesterday", the weekday this week, else the date. */
  title: string;
  entries: LocalHistoryEntry[];
}

const DAY_MS = 86_400_000;

const startOfDay = (time: number) => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function dayTitle(day: number, today: number) {
  const daysAgo = Math.round((today - day) / DAY_MS);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return formatDate(day, { weekday: "long" });
  const otherYear =
    new Date(day).getFullYear() !== new Date(today).getFullYear();
  return formatDate(day, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(otherYear && { year: "numeric" }),
  });
}

/** Entries, newest first, in runs under the local day they happened on. */
export function groupByDay(
  entries: LocalHistoryEntry[],
  now = Date.now(),
): DayGroup[] {
  const today = startOfDay(now);
  const groups: (DayGroup & { day: number })[] = [];
  for (const entry of entries) {
    const day = startOfDay(entry.time);
    const last = groups.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, title: dayTitle(day, today), entries: [entry] });
  }
  return groups.map(({ title, entries }) => ({ title, entries }));
}

export const timeText = (time: number) =>
  formatDate(time, { hour: "2-digit", minute: "2-digit" });

export function sizeText(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
