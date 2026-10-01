// Reads a typed snooze time: "45m", "2h30m", "an hour", "tomorrow",
// "fri 3pm", "next tue 9:30", "oct 12", "12.10. 14:00", "tonight".
// Unknown words make the whole thing unreadable rather than half-guessed.

const MIN = 60_000,
  HOUR = 60 * MIN,
  DAY = 24 * HOUR;

const UNITS: [RegExp, number][] = [
  [/^(m|mins?|minutes?)$/, MIN],
  [/^(h|hrs?|hours?)$/, HOUR],
  [/^(d|days?)$/, DAY],
  [/^(w|wks?|weeks?)$/, 7 * DAY],
];

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const PARTS: Record<string, number> = {
  morning: 9,
  noon: 12,
  midday: 12,
  lunch: 12,
  afternoon: 15,
  evening: 18,
  eod: 18,
  tonight: 20,
  night: 20,
};

/** A whole word, or three or more letters of one: "tom", "wed", "octo". */
const prefixOf = (token: string, word: string) =>
  token === word || (token.length >= 3 && word.startsWith(token));

function duration(text: string): number | null {
  const spelled = text
    .replace(/^half an? hour$/, "30 min")
    .replace(/^an? (?=[a-z])/, "1 ");
  const parts = [...spelled.matchAll(/(\d+(?:[.,]\d+)?)\s*([a-z]+)/g)];
  if (!parts.length) return null;
  const rest = spelled.replace(/(\d+(?:[.,]\d+)?)\s*([a-z]+)/g, "");
  if (rest.replace(/\band\b/g, "").trim()) return null;
  let total = 0;
  for (const [, amount, unit] of parts) {
    const ms = UNITS.find(([re]) => re.test(unit))?.[1];
    if (!ms) return null;
    total += Number(amount.replace(",", ".")) * ms;
  }
  return total;
}

type Time = { h: number; m: number };

function clock(
  token: string,
  next?: string,
): { time: Time; used: number } | null {
  const match = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/.exec(token);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2] ?? 0);
  let meridiem = match[3];
  let used = 1;
  if (!meridiem && (next === "am" || next === "pm")) {
    meridiem = next;
    used = 2;
  }
  if (m > 59) return null;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (meridiem.startsWith("p") ? 12 : 0);
  } else if (h > 23) return null;
  // A bare "3" during the working day means the afternoon.
  else if (!match[2] && h >= 1 && h <= 7) h += 12;
  return { time: { h, m }, used };
}

const midnight = (date: Date) => {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
};
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
/** This year's `month`/`day`, or next year's once it has passed. */
function upcoming(today: Date, month: number, day: number): Date | null {
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    const date = new Date(year, month, day);
    if (date.getMonth() !== month) return null;
    if (date >= today) return date;
  }
  return null;
}

export function parseWhen(input: string, now: Date): number | null {
  const text = input
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(in|at|on|until|till|for) /, "");
  if (!text) return null;
  const span = duration(text);
  if (span !== null) return span > 0 ? now.getTime() + span : null;

  const today = midnight(now);
  const tokens = text
    .split(" ")
    .filter((t) => !["at", "on", "this", "the"].includes(t));
  let day: Date | null = null;
  let weekday = false;
  let time: Time | null = null;
  let next = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "next") {
      next = true;
      continue;
    }
    if (next && (token === "week" || token === "wk")) {
      day = addDays(today, (8 - today.getDay()) % 7 || 7);
      next = false;
      continue;
    }
    if (next && token === "month") {
      day = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        today.getDate(),
      );
      next = false;
      continue;
    }
    if (prefixOf(token, "today") && token !== "tonight") {
      day = today;
      continue;
    }
    if (
      ["tmrw", "tmr", "tmw", "tmrow"].includes(token) ||
      prefixOf(token, "tomorrow")
    ) {
      day = addDays(today, 1);
      continue;
    }
    if (prefixOf(token, "weekend")) {
      day = addDays(today, (6 - today.getDay() + 7) % 7 || 7);
      continue;
    }
    const wd = WEEKDAYS.findIndex((w) => prefixOf(token, w));
    if (wd >= 0 && !(token in PARTS)) {
      let ahead = (wd - today.getDay() + 7) % 7;
      // "next fri" is Friday of next week, which starts on Monday.
      if (next) {
        const toMonday = (8 - today.getDay()) % 7 || 7;
        ahead = toMonday + ((wd + 6) % 7);
      }
      day = addDays(today, ahead);
      weekday = !next;
      next = false;
      continue;
    }
    const month = MONTHS.findIndex((m) => prefixOf(token, m));
    if (month >= 0) {
      // "oct 12" or "12 oct": the number beside it is the day.
      const after = /^(\d{1,2})(st|nd|rd|th)?$/.exec(tokens[i + 1] ?? "");
      const before = /^(\d{1,2})(st|nd|rd|th)?$/.exec(tokens[i - 1] ?? "");
      if (after) {
        day = upcoming(today, month, Number(after[1]));
        i++;
      } else if (before && day === null && time) {
        // The number was read as a time a step ago.
        day = upcoming(today, month, Number(before[1]));
        time = null;
      } else day = upcoming(today, month, 1);
      if (!day) return null;
      continue;
    }
    const ordinal = /^(\d{1,2})(st|nd|rd|th)$/.exec(token);
    if (ordinal) {
      const n = Number(ordinal[1]);
      day = upcoming(today, today.getMonth(), n);
      if (!day || day.getDate() !== n)
        day = new Date(today.getFullYear(), today.getMonth() + 1, n);
      if (day.getDate() !== n) return null;
      continue;
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
    if (iso) {
      day = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      if (day.getDate() !== Number(iso[3])) return null;
      continue;
    }
    // "12.10." and "12.10.2026" are dates; "12.10" is one only when it can be.
    const dotted = /^(\d{1,2})\.(\d{1,2})(\.(\d{2,4})?)?$/.exec(token);
    if (dotted) {
      const [d, m] = [Number(dotted[1]), Number(dotted[2]) - 1];
      const explicit = dotted[3] !== undefined;
      const valid = m >= 0 && m < 12 && d >= 1 && d <= 31;
      if (explicit || valid) {
        if (!valid) return null;
        const year = dotted[4];
        day = year
          ? new Date(Number(year.length === 2 ? `20${year}` : year), m, d)
          : upcoming(today, m, d);
        if (!day || day.getDate() !== d) return null;
        continue;
      }
    }
    const part = Object.keys(PARTS).find((p) => prefixOf(token, p));
    if (part) {
      time = { h: PARTS[part], m: 0 };
      continue;
    }
    const read = clock(token, tokens[i + 1]);
    if (read) {
      time = read.time;
      i += read.used - 1;
      continue;
    }
    return null;
  }
  if (!day && !time) return null;
  const isToday = day?.getTime() === today.getTime();
  const at = new Date(day ?? today);
  // A day on its own wakes at nine; "today" on its own, this evening.
  const { h, m } = time ?? (isToday ? { h: 18, m: 0 } : { h: 9, m: 0 });
  at.setHours(h, m, 0, 0);
  // A time alone, or this weekday's name, rolls over to the next one.
  if (at <= now && !day) at.setDate(at.getDate() + 1);
  if (at <= now && weekday) at.setDate(at.getDate() + 7);
  if (at <= now || at.getTime() - now.getTime() > 400 * DAY) return null;
  return at.getTime();
}

const timeOf = (at: Date) =>
  at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Today 15:00", "Tomorrow 9:00", "Fri 2 Oct, 9:00". */
export function whenLabel(at: number, now: Date): string {
  const wake = new Date(at);
  const days = Math.round(
    (midnight(wake).getTime() - midnight(now).getTime()) / DAY,
  );
  if (days === 0) return `Today ${timeOf(wake)}`;
  if (days === 1) return `Tomorrow ${timeOf(wake)}`;
  const date = wake.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(wake.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
  return `${date}, ${timeOf(wake)}`;
}

/** "in 45 min", "in 2 h 15 min", "in 30 h", "in 3 days". */
export function fromNow(at: number, now: Date): string {
  const mins = Math.round((at - now.getTime()) / MIN);
  if (mins < 60) return `in ${Math.max(mins, 1)} min`;
  const h = Math.floor(mins / 60),
    m = mins % 60;
  if (h < 10 && m) return `in ${h} h ${m} min`;
  if (h < 48) return `in ${h} h`;
  const days = Math.round(
    (midnight(new Date(at)).getTime() - midnight(now).getTime()) / DAY,
  );
  return `in ${days} days`;
}

export { MIN, HOUR, DAY, midnight, addDays };
