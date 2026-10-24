// Prompts Relay sends on its own on a schedule: what one is, when it runs
// next, and the Api the Schedules page uses. A schedule lives on the
// computer it was made on and runs only while Relay runs there.
import { z } from "zod";
import { runtimeModeSchema } from "./agent-modes";
import { agentProviderSchema } from "./agents";
import { aiSettingsSchema } from "./settings";
import { idSchema } from "./validation";

/** A schedule's project when it has none: each run is a Scratchpad chat. */
export const SCRATCHPAD_SCHEDULE = "scratchpad";

export const scheduleRepeats = ["daily", "weekdays", "weekly", "monthly"] as const;
export type ScheduleRepeat = (typeof scheduleRepeats)[number];

/** When a schedule runs, in this computer's time. */
export const scheduleWhenSchema = z
  .object({
    repeat: z.enum(scheduleRepeats),
    /** The weekdays a weekly one runs on, 0 for Monday. */
    days: z.array(z.number().int().min(0).max(6)).max(7),
    /** The date a monthly one runs on; a shorter month runs on its last day. */
    monthDay: z.number().int().min(1).max(31).optional(),
    /** "09:00". */
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();
export type ScheduleWhen = z.infer<typeof scheduleWhenSchema>;

/** What the page and the agents' tools set; Relay keeps the rest. */
export const scheduleInputSchema = scheduleWhenSchema
  .extend({
    name: z.string().trim().min(1).max(120),
    projectId: idSchema.or(z.literal(SCRATCHPAD_SCHEDULE)),
    /** Empty while it's being written; it can't be turned on like that. */
    prompt: z.string().max(32000),
    /** Off: every run adds a turn to the thread the last one used. */
    freshChat: z.boolean(),
    /** A worktree of its own for each run, or the project's folder. */
    workspace: z.enum(["worktree", "checkout"]),
    agent: agentProviderSchema,
    choice: aiSettingsSchema.shape.questions,
    runtimeMode: runtimeModeSchema,
    /** Tokens one run may use before Relay stops it; 0 for no limit. */
    tokenLimit: z.number().int().min(0).max(10_000_000),
    enabled: z.boolean(),
  })
  .strict();
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

/** Only the fields a schedule is saved with, of one Relay keeps more on. */
export function scheduleInputOf(s: ScheduleInput): ScheduleInput {
  const keys = Object.keys(scheduleInputSchema.shape) as (keyof ScheduleInput)[];
  return Object.fromEntries(keys.filter((k) => s[k] !== undefined).map((k) => [k, s[k]])) as ScheduleInput;
}

export type ScheduleOutcome = "running" | "done" | "skipped" | "failed" | "stopped";

export interface ScheduleRun {
  id: string;
  /** When it started, or was skipped. */
  at: number;
  outcome: ScheduleOutcome;
  /** The answer's first line, or why it didn't run or finish. */
  summary?: string;
  /** About what it used, as its agent reported it. */
  tokens?: number;
  chatId?: string;
  /** The thread's project; a Scratchpad run's is its own. */
  projectId?: string;
  /** The message Relay sent, whose answer the run is. */
  messageId?: string;
  /** Started with Test run rather than by the clock. */
  test?: true;
}

export interface Schedule extends ScheduleInput {
  id: string;
  created: number;
  /** The last time it was due, run or not; nothing before it is still owed. */
  handledUntil: number;
  /** The thread an agent set it up in. */
  setUpIn?: { chatId: string; title: string };
  /** The thread its runs carry on in when they don't start a new chat. */
  lastChatId?: string;
  /** Newest first, at most RUNS_KEPT. */
  runs: ScheduleRun[];
}

export const RUNS_KEPT = 50;

export const scheduleMessageSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    test: z.literal(true).optional(),
  })
  .strict();
/** On a message Relay sent for a schedule; its header says so. */
export type ScheduleMessage = z.infer<typeof scheduleMessageSchema>;

export interface ScheduleApi {
  schedules(): Promise<Schedule[]>;
  /** Makes one without an id, changes the one with it. */
  saveSchedule(id: string | null, input: ScheduleInput): Promise<Schedule>;
  deleteSchedule(id: string): Promise<void>;
  /** Runs it now, as a test; the thread it started. */
  testSchedule(id: string): Promise<string>;
  onSchedules(callback: (schedules: Schedule[]) => void): () => void;
}

const MINUTE = 60_000;

function daysIn(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/** Whether it runs at all on the day `d` falls on. */
export function runsOnDay(when: ScheduleWhen, d: Date) {
  const weekday = (d.getDay() + 6) % 7;
  switch (when.repeat) {
    case "daily":
      return true;
    case "weekdays":
      return weekday < 5;
    case "weekly":
      return (when.days.length ? when.days : [4]).includes(weekday);
    case "monthly": {
      const last = daysIn(d.getFullYear(), d.getMonth());
      return d.getDate() === Math.min(when.monthDay ?? 1, last);
    }
  }
}

/** The first time it's due after `after`, in this computer's time. */
export function nextRun(when: ScheduleWhen, after: number): number {
  const [h, m] = when.time.split(":").map(Number);
  const start = new Date(after);
  // A year and a bit covers the longest gap, a monthly run on the 31st.
  for (let i = 0; i < 400; i++) {
    const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, h, m);
    if (at.getTime() > after && runsOnDay(when, at)) return at.getTime();
  }
  // Unreachable for a valid schedule; a day on keeps a timer from spinning.
  return after + 24 * 60 * MINUTE;
}

/** The next `count` times it's due after `after`. */
export function nextRuns(when: ScheduleWhen, after: number, count: number) {
  const out: number[] = [];
  let at = after;
  for (let i = 0; i < count; i++) out.push((at = nextRun(when, at)));
  return out;
}

/** The times it was due after `from` up to `until`, oldest first; at most `limit`. */
export function dueBetween(when: ScheduleWhen, from: number, until: number, limit = 400) {
  const out: number[] = [];
  for (let at = nextRun(when, from); at <= until && out.length < limit; at = nextRun(when, at))
    out.push(at);
  return out;
}

const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "Fridays at 9:00", "Weekdays at 8:00", "Monthly on the 1st at 7:30". */
export function scheduleWhenLabel(when: ScheduleWhen) {
  const time = when.time.replace(/^0(?=\d:)/, "");
  switch (when.repeat) {
    case "daily":
      return `Every day at ${time}`;
    case "weekdays":
      return `Weekdays at ${time}`;
    case "monthly":
      return `Monthly on the ${ordinal(when.monthDay ?? 1)} at ${time}`;
    case "weekly": {
      const days = when.days.length ? when.days : [4];
      return days.length === 1
        ? `${weekdayNames[days[0]]}s at ${time}`
        : `${days.map((d) => weekdayNames[d].slice(0, 3)).join(", ")} at ${time}`;
    }
  }
}
