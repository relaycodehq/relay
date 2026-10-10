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
