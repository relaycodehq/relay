// The calendar side of the usage summary: which days were counted and how
// spend and busy time land on hours and weekdays.
import { agentProviders } from "./agents";
import type { PerProvider, UsageDay, UsageSlot } from "./usage";

export const perProvider = (): PerProvider =>
  Object.fromEntries(agentProviders.map((p) => [p, 0])) as PerProvider;

export const slots = (n: number): UsageSlot[] =>
  Array.from({ length: n }, () => ({ usd: 0, fresh: 0, minutes: 0, days: 0 }));

export const weekday = (at: number) => (new Date(at).getDay() + 6) % 7;

export function midnight(at: number) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The next local midnight, a day on even across a daylight-saving change. */
function nextDay(day: number) {
  const d = new Date(day);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Days before Relay counted anything would only draw as an empty stretch. */
export function countedDays(
  from: number,
  since: number | undefined,
  today: number,
) {
  const days: UsageDay[] = [];
  for (
    let day = Math.max(from, since === undefined ? from : midnight(since));
    day <= today;
    day = nextDay(day)
  )
    days.push({ day, usd: perProvider(), fresh: perProvider(), answers: 0 });
  return days;
}

/** Busy minutes of a run spread over the hours and days it covered. */
export function addBusy(
  hours: UsageSlot[],
  weekdays: UsageSlot[],
  at: number,
  ms: number,
) {
  let t = at;
  const end = at + ms;
  while (t < end) {
    const d = new Date(t);
    const next = new Date(d);
    next.setMinutes(60, 0, 0);
    const stop = Math.min(end, next.getTime());
    const minutes = (stop - t) / 60_000;
    hours[d.getHours()].minutes += minutes;
    weekdays[weekday(t)].minutes += minutes;
    t = stop;
  }
}
