// Relay's own record of an account's usage over time. The providers only
// report the current percentages, so the hours someone actually works are
// learned from readings taken while Relay is open.

export type UsageSample = {
  at: number;
  /** Session percent used; it moves fast enough to show an hour's work. */
  session: number | null;
  weekly: number | null;
};

/** Hour-of-day (local time) share of days that hour saw usage, 0..1. */
export type ActiveHours = number[];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SAMPLE_EVERY = 10 * MINUTE;
const KEEP = 28 * DAY;
// Readings further apart than this span a closed lid or a quit app.
const MAX_GAP = 45 * MINUTE;
const MIN_DAYS = 5;

export function addSample(
  samples: UsageSample[],
  sample: UsageSample,
): UsageSample[] {
  const last = samples.at(-1);
  if (last && sample.at - last.at < SAMPLE_EVERY) return samples;
  return [...samples.filter((s) => sample.at - s.at < KEEP), sample];
}

function rose(from: number | null, to: number | null) {
  return from != null && to != null && to > from;
}

/**
 * How likely each hour of the day is to see usage, from pairs of nearby
 * readings. Null until enough separate days have been seen to mean anything.
 */
export function activeHours(samples: UsageSample[]): ActiveHours | null {
  const observed = new Set<string>();
  const active = new Set<string>();
  const days = new Set<string>();
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (b.at - a.at > MAX_GAP) continue;
    const date = new Date(a.at);
    const day = date.toDateString();
    const key = `${day}|${date.getHours()}`;
    days.add(day);
    observed.add(key);
    if (rose(a.session, b.session) || rose(a.weekly, b.weekly)) active.add(key);
  }
  if (days.size < MIN_DAYS || !active.size) return null;
  const seen = Array<number>(24).fill(0);
  const used = Array<number>(24).fill(0);
  for (const key of observed) seen[Number(key.split("|")[1])]++;
  for (const key of active) used[Number(key.split("|")[1])]++;
  return seen.map((count, hour) => (count ? used[hour] / count : 0));
}

/** Expected active hours between two times under a profile. */
export function activeWeight(
  profile: ActiveHours,
  from: number,
  to: number,
): number {
  let total = 0;
  let t = from;
  while (t < to) {
    const next = Math.min(to, nextHour(t));
    total += (profile[new Date(t).getHours()] * (next - t)) / HOUR;
    t = next;
  }
  return total;
}

/** Start of the next local hour, which half-hour time zones don't align. */
export function nextHour(t: number): number {
  const date = new Date(t);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours() + 1,
  ).getTime();
}
