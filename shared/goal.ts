// A thread's native `/goal`: Codex and Claude Code keep working, turn after
// turn, until they judge an objective met. The agent owns the goal; Relay
// mirrors the latest state it reported, for the composer, sidebar and phone.

export type GoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usage_limited"
  | "budget_limited"
  | "complete"
  /** Claude judged the goal impossible. */
  | "failed";

export interface ThreadGoal {
  provider: "codex" | "claude";
  objective: string;
  status: GoalStatus;
  /** Codex's accounting across the goal's turns. */
  tokensUsed?: number;
  tokenBudget?: number;
  timeUsedSeconds?: number;
  /** Claude: checks that found the goal unmet, and what the latest one said. */
  checks?: number;
  lastCheck?: string;
  /** Claude stopped checking after too many unmet checks in a row; the goal stays set. */
  gaveUp?: true;
  updated: number;
}

export type GoalCommand =
  | { type: "show" | "clear" | "pause" | "resume" }
  | { type: "set"; objective: string };

// Claude Code's own words for clearing a goal; Codex's TUI takes `clear`.
const clearWords = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);

/** A `/goal` message as both agents read it: any other text is the new objective. */
export function parseGoalCommand(text: string): GoalCommand | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const argument = (match[1] ?? "").trim();
  const word = argument.toLowerCase();
  if (!word) return { type: "show" };
  if (clearWords.has(word)) return { type: "clear" };
  if (word === "pause" || word === "resume") return { type: word };
  return { type: "set", objective: argument };
}

/** Whether two reports differ in what the thread shows, tokens and time aside. */
export function goalChanged(
  before: ThreadGoal | null | undefined,
  after: ThreadGoal | null | undefined,
) {
  if (!before || !after) return !before !== !after;
  return (
    before.objective !== after.objective ||
    before.status !== after.status ||
    before.checks !== after.checks ||
    before.gaveUp !== after.gaveUp
  );
}

const titles: Record<GoalStatus, string> = {
  active: "Pursuing goal",
  paused: "Goal paused",
  blocked: "Goal blocked",
  usage_limited: "Goal hit a usage limit",
  budget_limited: "Goal reached its token budget",
  complete: "Goal complete",
  failed: "Goal can't be met",
};

function tokens(value: number) {
  if (value < 1_000) return `${value}`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function minutes(seconds: number) {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * What the goal row says and offers. An active goal on an idle thread is set,
 * not pursued: Claude after Stop, or a goal a crash left behind. Only Codex
 * pauses and resumes; Claude's `/goal` sets and clears.
 */
export function presentGoal(goal: ThreadGoal, running: boolean) {
  const usage: string[] = [];
  if (goal.tokensUsed)
    usage.push(
      goal.tokenBudget
        ? `${tokens(goal.tokensUsed)} / ${tokens(goal.tokenBudget)} tokens`
        : `${tokens(goal.tokensUsed)} tokens`,
    );
  if (goal.timeUsedSeconds && goal.timeUsedSeconds >= 60)
    usage.push(minutes(goal.timeUsedSeconds));
  if (goal.checks)
    usage.push(`${goal.checks} ${goal.checks === 1 ? "check" : "checks"}`);
  const codex = goal.provider === "codex";
  const settled = goal.status === "complete" || goal.status === "failed";
  return {
    title:
      goal.status === "active" && !running
        ? goal.gaveUp
          ? "Goal not met yet"
          : "Goal set"
        : titles[goal.status],
    objective: goal.objective,
    usage: usage.join(" · "),
    /** Why it isn't met, as Claude's latest check put it. */
    detail:
      goal.status === "failed" || goal.gaveUp ? goal.lastCheck : undefined,
    canPause: codex && goal.status === "active",
    // As in Codex's TUI: a goal over its token budget goes on only once the budget does.
    canResume:
      codex &&
      !running &&
      goal.status !== "active" &&
      goal.status !== "budget_limited" &&
      !settled,
    // Claude reads a clear only between turns; a running Codex goal takes it at once.
    canClear: !settled && (codex || !running),
    /** Pursued right now: the thread works on it. */
    working: running && goal.status === "active",
  };
}
