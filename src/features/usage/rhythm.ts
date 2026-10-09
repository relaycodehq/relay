// When the agents burn the most: the busiest stretch of an average day and
// the busiest day of an average week, by whichever measure the page shows.
import type {
  UsageMeasure,
  UsageSlot,
  UsageSummary,
} from "../../../shared/usage";
import { clock, compact, usd } from "./format";

/** A weekday is only called the busiest once each has come round twice. */
export const DAYS_FOR_A_WEEKDAY = 14;

/** Hours in the stretch the page calls the busiest. */
export const STRETCH = 4;

export const average = (slot: UsageSlot, m: UsageMeasure) =>
  slot.days ? slot[m] / slot.days : 0;

/** The first hour of the busiest run of `span` hours, wrapping past midnight. */
export function busiestStretch(values: number[], span = STRETCH) {
  let best = 0;
  let start: number | null = null;
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    for (let k = 0; k < span; k++) sum += values[(i + k) % values.length];
    if (sum > best) [best, start] = [sum, i];
  }
  return start;
}

export const inStretch = (hour: number, start: number, span = STRETCH) =>
  (hour - start + 24) % 24 < span;

/** Null parts when there is nothing yet, or too few days to tell weekdays apart. */
export function rhythm(
  hours: UsageSlot[],
  weekdays: UsageSlot[],
  m: UsageMeasure,
) {
  const start = busiestStretch(hours.map((h) => average(h, m)));
  const counted = weekdays.reduce((n, d) => n + d.days, 0);
  const week = weekdays.map((d) => average(d, m));
  const top = Math.max(...week);
  return {
    start,
    weekday:
      counted >= DAYS_FOR_A_WEEKDAY && top > 0 ? week.indexOf(top) : null,
  };
}

export const weekdayNames = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** What the lede says: the busiest stretch, and the weekday once there is one. */
export function rhythmLine(summary: UsageSummary, m: UsageMeasure) {
  const { start, weekday } = rhythm(summary.hours, summary.weekdays, m);
  return {
    start,
    weekday,
    stretch:
      start === null ? null : `${clock(start)}–${clock(start + STRETCH)}`,
    weekdays: weekday === null ? null : `${weekdayNames[weekday]}s`,
  };
}

/** The total by a measure, said the way the lede's second line says it. */
export function headline(summary: UsageSummary, m: UsageMeasure) {
  const { totals } = summary;
  if (m === "fresh")
    return `${compact(totals.fresh)} tokens, ${compact(totals.tokens - totals.fresh)} more re-read from cache`;
  return `${usd(totals.usd)}${totals.unpriced ? " + unpriced" : ""} at API prices`;
}
