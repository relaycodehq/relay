import type { ClockifyProject } from "../../../shared/clockify";
import type { SearchOption } from "../../ui/SearchSelect";

/** `8:30`, or `8:30 AM` where the locale uses a 12-hour clock. */
export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** `3:05` of elapsed time. */
export const elapsed = (ms: number) => {
  const minutes = Math.floor(ms / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

/**
 * A typed time of day, on the same day as `on`: `8:40`, `840`, `8`, `8.40`,
 * `8:40 pm`. Undefined when it isn't one.
 */
export function parseClock(text: string, on: number): number | undefined {
  const m = text
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?:[:.\s]?(\d{2}))?\s*(am?|pm?)?$/);
  if (!m) return;
  let hours = Number(m[1]);
  const minutes = Number(m[2] ?? 0);
  if (m[3]) {
    if (hours < 1 || hours > 12) return;
    hours = (hours % 12) + (m[3].startsWith("p") ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return;
  const at = new Date(on);
  at.setHours(hours, minutes, 0, 0);
  return at.getTime();
}

/** Clockify's projects to pick from, client beside each, under a "none" row. */
export const clockifyProjectOptions = (
  projects: readonly ClockifyProject[] | undefined,
  none: string,
): SearchOption[] => [
  { value: "", label: none },
  ...(projects ?? []).map((p) => ({
    value: p.id,
    label: p.name,
    detail: p.clientName,
  })),
];
