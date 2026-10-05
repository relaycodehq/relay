import type { SDKMessage } from "./sdk";
import type { ThreadGoal } from "../../../../shared/goal";

// Claude Code reports `/goal` to an SDK client only in the transcript (its
// `active_goal` frame never reaches one, checked on 2.1.288): the command's
// synthetic reply names the goal, and each unmet check comes back as Stop
// hook feedback. A met goal has no frame of its own; see `ended`.
const SET = "Goal set: ";
const ACTIVE =
  /^Goal active: ([\s\S]+?) \((?:not yet evaluated|(\d+) turns?)\)/;
const CLEARED = /^(?:Goal cleared|No goal set)/;
const FEEDBACK = "Stop hook feedback:\n[";
// After this many unmet checks in a row Claude ends the turn anyway.
const BLOCK_CAP = "stop-hook-block-cap";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type?: string; text?: string }) =>
      part?.type === "text" ? (part.text ?? "") : "",
    )
    .join("");
}

/**
 * A thread's Claude goal, read from what its session says. It outlives each
 * turn: the goal does, and its checks are counted across them.
 */
export class ClaudeGoalWatch {
  private onGoal?: (goal: ThreadGoal | null) => void;
  // Claude answered after the goal was set or last found unmet, so a turn
  // that ends on its own passed the goal's check.
  private replied = false;
  constructor(public goal: ThreadGoal | null | undefined) {}

  /** Each turn hears of changes through its own callback. */
  listen(onGoal: ((goal: ThreadGoal | null) => void) | undefined) {
    this.onGoal = onGoal;
  }

  /** Reads one frame; "checked" when Claude found the goal unmet and works on. */
  see(message: SDKMessage): "checked" | undefined {
    if (message.type === "assistant" && !message.parent_tool_use_id) {
      if (message.message.model !== "<synthetic>") {
        if (this.goal?.status === "active") this.replied = true;
        return;
      }
      const text = textOf(message.message.content).trim();
      if (text.startsWith(SET)) {
        const objective = text.slice(SET.length).trim();
        if (objective) this.set({ objective, status: "active", checks: 0 });
      } else if (CLEARED.test(text)) this.set(null);
      else {
        const active = ACTIVE.exec(text);
        if (active?.[1])
          this.set({
            ...(this.goal?.objective === active[1] ? this.goal : {}),
            objective: active[1],
            status: "active",
            checks: Number(active[2] ?? 0),
          });
      }
      return;
    }
    if (
      message.type === "user" &&
      !message.parent_tool_use_id &&
      message.isSynthetic &&
      this.goal?.status === "active"
    ) {
      const prefix = `${FEEDBACK}${this.goal.objective}]: `;
      const text = textOf(message.message.content);
      if (!text.startsWith(prefix)) return;
      this.replied = false;
      // Working on again: no longer given up.
      const { gaveUp: _, ...goal } = this.goal;
      this.set({
        ...goal,
        checks: (goal.checks ?? 0) + 1,
        lastCheck: text.slice(prefix.length).trim(),
      });
      return "checked";
    }
    const note = message as { type: string; subtype?: string; key?: string };
    if (
      note.type === "system" &&
      note.subtype === "notification" &&
      note.key === BLOCK_CAP &&
      this.goal?.status === "active"
    ) {
      this.replied = false;
      this.set({ ...this.goal, gaveUp: true });
    }
  }

  /**
   * The turn ended. Claude stops on its own with a goal set only once the
   * goal's check passes, and clears it then; the check waits while
   * background work runs. It doesn't report a check that timed out or a goal
   * it judged impossible, so those read as met too.
   */
  ended(completed: boolean, background: boolean) {
    const goal = this.goal;
    if (goal?.status === "active" && this.replied && completed && !background)
      this.set({
        objective: goal.objective,
        status: "complete",
        ...(goal.checks ? { checks: goal.checks } : {}),
      });
    this.replied = false;
  }

  /**
   * What a turn says when Claude stopped checking: its own replies went
   * above as steps, and the turn's result is empty.
   */
  gaveUpNote() {
    const goal = this.goal;
    if (goal?.status !== "active" || !goal.gaveUp) return;
    const checks = goal.checks ?? 0;
    return `Claude stopped working toward the goal after ${checks} ${checks === 1 ? "check" : "checks"} found it unmet. The goal is still set: send a message to go on, or /goal clear.${goal.lastCheck ? `\n\nLast check: ${goal.lastCheck}` : ""}`;
  }

  private set(goal: Omit<ThreadGoal, "provider" | "updated"> | null) {
    const next: ThreadGoal | null = goal && {
      ...goal,
      provider: "claude",
      updated: Date.now(),
    };
    this.goal = next;
    this.onGoal?.(next);
  }
}
