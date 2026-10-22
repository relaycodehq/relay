import type { AgentOptions } from "../types";
import { answerLimitError, TurnText } from "../turn-kit";
import {
  cursorActivity,
  cursorEdits,
  cursorPlan,
  type CursorCall,
} from "./activity";
import type { CursorUpdate } from "./protocol";

/** What Cursor's worker says during one turn, put to the thread as it comes. */
export class CursorTurnEvents {
  readonly turn: TurnText;
  /** Steering messages sent, until Cursor says it read one. */
  readonly steers: (string | undefined)[] = [];
  agentId: string | undefined;
  private capped = false;

  constructor(
    private options: AgentOptions,
    /** The answer outgrew its limit; the turn ends. */
    private overflowed: (error: Error) => void,
  ) {
    this.turn = new TurnText(options.onText, options.onCommentary);
    this.agentId = options.session?.id;
  }

  handle = (update: CursorUpdate) => {
    switch (update.type) {
      case "agent": {
        const id = String(update.agentId ?? "");
        if (id && id !== this.agentId) {
          this.agentId = id;
          void this.options.session?.onId(id);
        }
        return;
      }
      case "text-delta": {
        this.turn.add(String(update.text ?? ""));
        const over = answerLimitError(this.turn.size);
        if (over && !this.capped) {
          this.capped = true;
          this.overflowed(over);
        }
        return;
      }
      case "tool-call-started":
      case "tool-call-completed": {
        const done = update.type === "tool-call-completed";
        const call = update.toolCall as CursorCall | undefined;
        if (!call) return;
        if (!done) this.turn.toCommentary();
        const activity = cursorActivity(
          String(update.callId ?? ""),
          call,
          done,
        );
        if (activity) this.options.onActivity?.(activity);
        const edits = cursorEdits(call);
        if (edits.length) this.options.onEdit?.(edits);
        const plan = done ? cursorPlan(call) : undefined;
        if (plan) this.options.onPlan?.(plan);
        return;
      }
      case "token-delta": {
        // Cursor counts tokens as they stream, without a split or a model.
        const tokens = Number(update.tokens);
        if (tokens > 0)
          this.options.onUsage?.({
            model: this.options.choice.model || "cursor",
            fast: this.options.choice.fast,
            tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: tokens },
          });
        return;
      }
      case "summary-started":
        this.options.onCommentary?.(
          "cursor-summary",
          "Summarizing the conversation…",
        );
        return;
      case "summary-completed":
        this.options.onCommentary?.("cursor-summary", null);
        return;
      case "user-message-appended": {
        // Cursor read the oldest steering message; the rest of the turn answers it.
        if (!this.steers.length) return;
        const id = this.steers.shift();
        this.turn.reset();
        if (id) this.options.onSteered?.(id);
      }
    }
  };
}
