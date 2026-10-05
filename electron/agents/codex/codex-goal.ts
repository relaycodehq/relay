import { z } from "zod";
import type { GoalCommand, GoalStatus, ThreadGoal } from "../../../shared/goal";
import type { CodexTransport } from "./codex-transport";

const statuses = {
  active: "active",
  paused: "paused",
  blocked: "blocked",
  usageLimited: "usage_limited",
  budgetLimited: "budget_limited",
  complete: "complete",
} as const satisfies Record<string, GoalStatus>;

const threadGoalSchema = z
  .object({
    objective: z.string(),
    status: z.enum(Object.keys(statuses) as [keyof typeof statuses]),
    tokenBudget: z.number().nullish(),
    tokensUsed: z.number().nullish(),
    timeUsedSeconds: z.number().nullish(),
  })
  .loose();

/** Codex's report of a thread goal, as Relay shows it; null for none, undefined for one it can't read. */
export function codexGoal(raw: unknown): ThreadGoal | null | undefined {
  if (raw == null) return null;
  const goal = threadGoalSchema.safeParse(raw).data;
  if (!goal) return;
  const objective = goal.objective.trim();
  if (!objective) return null;
  return {
    provider: "codex",
    objective,
    status: statuses[goal.status],
    ...(goal.tokensUsed ? { tokensUsed: Math.max(0, goal.tokensUsed) } : {}),
    ...(goal.tokenBudget ? { tokenBudget: goal.tokenBudget } : {}),
    ...(goal.timeUsedSeconds
      ? { timeUsedSeconds: Math.max(0, goal.timeUsedSeconds) }
      : {}),
    updated: Date.now(),
  };
}

/** Codex's goal RPCs on one thread, read into Relay's shape. */
export function codexGoals(wire: CodexTransport, threadId: string) {
  const one = async (method: string, params: Record<string, unknown>) =>
    codexGoal(
      (
        (await wire.request(method, { threadId, ...params })) as {
          goal?: unknown;
        }
      )?.goal,
    ) ?? null;
  return {
    get: () => one("thread/goal/get", {}),
    set: (params: { objective?: string; status: "active" | "paused" }) =>
      one("thread/goal/set", params),
    clear: async () =>
      !!(
        (await wire.request("thread/goal/clear", { threadId })) as {
          cleared?: boolean;
        }
      )?.cleared,
  };
}

/** What `/goal` without a turn says back, the way Codex's TUI words it. */
export function goalReply(
  command: Exclude<GoalCommand["type"], "set" | "resume">,
  goal: ThreadGoal | null,
  cleared = false,
) {
  if (command === "clear")
    return cleared ? "Goal cleared." : "No goal to clear.";
  if (!goal) return "No goal is set.";
  if (command === "pause") return "Goal paused. Send /goal resume to continue.";
  return `Goal ${goal.status.replace("_", " ")}: ${goal.objective}`;
}

// Codex starts the next goal turn milliseconds after the last one ends; this
// is the slack before a run takes it that Codex has stopped.
const CONTINUATION_GRACE = 5000;

/**
 * Keeps one Relay run open across the turns Codex starts on its own while
 * the thread's goal is active, so the thread reads as working until the goal
 * ends, not after each turn.
 */
export class CodexGoalHold {
  private grace?: ReturnType<typeof setTimeout>;
  /** Relay is turning the goal on behind a turn it started; that turn ending first still holds. */
  activating = false;
  constructor(
    /** The goal as Codex last reported it; undefined until it does. */
    public goal: ThreadGoal | null | undefined,
    private onGoal: (goal: ThreadGoal | null) => void,
    /** The run lets go: the goal ended, or Codex started no turn in time. */
    private release: () => void,
    private graceMs = CONTINUATION_GRACE,
  ) {}
  get active() {
    return this.goal?.status === "active";
  }
  private get holding() {
    return this.active || this.activating;
  }
  /** Between turns: the last one ended and the run waits for Codex's next. */
  get waiting() {
    return !!this.grace;
  }
  /** Codex reported the goal changed; one no longer active ends a run waiting for a turn. */
  seen(goal: ThreadGoal | null) {
    this.goal = goal;
    this.onGoal(goal);
    if (!this.holding && this.grace) this.let();
  }
  /** A turn completed: true when the run holds for the next one instead of finishing. */
  completed() {
    if (!this.holding) return false;
    this.wait();
    return true;
  }
  /** Waits for a turn Codex is about to start, e.g. on a resumed goal. */
  wait() {
    clearTimeout(this.grace);
    this.grace = setTimeout(() => this.let(), this.graceMs);
  }
  /** The goal is on, or failed to go on: a turn that ended meanwhile is judged now. */
  activated() {
    this.activating = false;
    if (!this.holding && this.grace) this.let();
  }
  /** Codex started the next goal turn. */
  started() {
    this.dispose();
  }
  dispose() {
    clearTimeout(this.grace);
    this.grace = undefined;
  }
  private let() {
    this.dispose();
    this.release();
  }
}
