import { z } from "zod";

export const clockifyHosts = {
  global: { label: "Global", url: "https://api.clockify.me/api/v1" },
  euc1: { label: "EU (Germany)", url: "https://euc1.clockify.me/api/v1" },
  euw2: { label: "UK", url: "https://euw2.clockify.me/api/v1" },
  use2: { label: "USA", url: "https://use2.clockify.me/api/v1" },
  apse2: { label: "Australia", url: "https://apse2.clockify.me/api/v1" },
} as const;
export type ClockifyHost = keyof typeof clockifyHosts;

const id = z.string().trim().max(100);

export const clockifySettingsSchema = z
  .object({
    host: z.enum(
      Object.keys(clockifyHosts) as [ClockifyHost, ...ClockifyHost[]],
    ),
    workspaceId: id,
    /** Relay project id → Clockify project id; only these projects are tracked. */
    projects: z.record(z.string().max(200), id.min(1)),
    /** Minutes a touch keeps its project busy when nothing else happens. */
    idleMinutes: z.number().int().min(1).max(120),
  })
  .strict();
export type ClockifySettings = z.infer<typeof clockifySettingsSchema>;

export const defaultClockifySettings: ClockifySettings = {
  host: "global",
  workspaceId: "",
  projects: {},
  idleMinutes: 20,
};

/** `undefined` keeps the saved token, `null` forgets it. */
export const clockifySecretsSchema = z
  .object({ token: z.string().trim().min(1).max(512).nullable().optional() })
  .strict();
export type ClockifySecrets = z.infer<typeof clockifySecretsSchema>;

/** The day being tracked. */
export interface ClockifyDay {
  start: number;
  pauses: { start: number; end?: number }[];
  /** Projects the person had open while the timer ran; see ClockifyTimer. */
  touches: { at: number; projectId: string; chatId?: string }[];
}

/** One entry of the day's timesheet, as reviewed before it goes to Clockify. */
export interface ClockifyBlock {
  id: string;
  start: number;
  end: number;
  /** The Relay project the time came from, if any. */
  relayProjectId: string | null;
  /** Where it goes in Clockify; empty leaves it out. */
  clockifyProjectId: string;
  description: string;
  reason?: "idle" | "other";
  /** Holds time from a turn that ran implausibly long, e.g. across a restart. */
  uncertain?: boolean;
  /** Threads the time came from, which the description is drawn from. */
  chatIds: string[];
  /** The Clockify entry this block became. */
  submittedId?: string;
}

export interface ClockifyReview {
  start: number;
  end: number;
  blocks: ClockifyBlock[];
  /** Titles of the threads the blocks came from, by chat id. */
  threads?: Record<string, string>;
  /** Luna is writing the descriptions. */
  describing?: boolean;
  describeError?: string;
  submitError?: string;
}

/** Only the fields that changed, so an edit never overwrites a description written meanwhile. */
export const clockifyBlockEditSchema = z
  .object({
    id: z.string().max(100),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
    clockifyProjectId: z.string().max(100).optional(),
    description: z.string().max(3000).optional(),
  })
  .strict();
export type ClockifyBlockEdit = z.infer<typeof clockifyBlockEditSchema>;

export interface ClockifyStatus {
  settings: ClockifySettings;
  hasToken: boolean;
  /** False when the token is kept for this session only. */
  persistent: boolean;
  day: Omit<ClockifyDay, "touches"> | null;
  review: ClockifyReview | null;
}

export interface ClockifyWorkspace {
  id: string;
  name: string;
}
export interface ClockifyProject {
  id: string;
  name: string;
  clientName?: string;
  color?: string;
}

export type ClockifyTimerAction = "start" | "pause" | "resume" | "stop";

export interface ClockifyApi {
  clockifyStatus(): Promise<ClockifyStatus>;
  /** Saves and, given a new token, checks it; returns the account's name. */
  saveClockifySettings(
    settings: ClockifySettings,
    secrets?: ClockifySecrets,
  ): Promise<ClockifyStatus & { account?: string }>;
  clockifyWorkspaces(): Promise<ClockifyWorkspace[]>;
  clockifyProjects(): Promise<ClockifyProject[]>;
  clockifyTimer(action: ClockifyTimerAction): Promise<ClockifyStatus>;
  /** The person is on this project; the timer's evidence of where the day went. */
  clockifyTouch(projectId: string, chatId?: string): Promise<void>;
  saveClockifyReview(blocks: ClockifyBlockEdit[]): Promise<ClockifyStatus>;
  describeClockifyReview(): Promise<ClockifyStatus>;
  submitClockifyReview(): Promise<ClockifyStatus>;
  /** Closes the review; unsent entries are dropped. */
  discardClockifyReview(): Promise<ClockifyStatus>;
}

/**
 * Drops entries dragged down to nothing and joins neighbours that now go to
 * the same Clockify project back to back.
 */
export function tidy(blocks: ClockifyBlock[]) {
  const out: ClockifyBlock[] = [];
  for (const b of blocks) {
    if (!b.submittedId && b.end <= b.start) continue;
    const last = out.at(-1);
    if (
      last &&
      !last.submittedId &&
      !b.submittedId &&
      last.clockifyProjectId &&
      last.clockifyProjectId === b.clockifyProjectId &&
      last.end === b.start
    ) {
      out[out.length - 1] = {
        ...last,
        end: b.end,
        description: last.description || b.description,
        relayProjectId: last.relayProjectId ?? b.relayProjectId,
        chatIds: [...new Set([...last.chatIds, ...b.chatIds])],
        uncertain: last.uncertain || b.uncertain || undefined,
        reason: undefined,
      };
    } else out.push(b);
  }
  return out;
}

/** Elapsed working time of a day at `now`, without its pauses. */
export function dayElapsed(
  day: Pick<ClockifyDay, "start" | "pauses">,
  now: number,
) {
  const paused = day.pauses.reduce(
    (sum, p) => sum + Math.max(0, (p.end ?? now) - p.start),
    0,
  );
  return Math.max(0, now - day.start - paused);
}

/** `1 h 05 min`, `12 min`. */
export function formatDuration(ms: number) {
  const total = Math.round(ms / 60_000);
  const h = Math.floor(total / 60),
    m = total % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}
