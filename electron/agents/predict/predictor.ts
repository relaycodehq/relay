import type { PredictionAsked } from "../../../shared/prediction";
import type { AgentPredict } from "../types";
import { predictionPrompt, parsePrediction } from "./prompt";

/** Main-agent calls a turn needs before its next message is worth guessing. */
const MIN_CALLS = 3;
/** Wrap-up asks; what follows one is rarely a message worth drafting. */
const CHORE =
  /^\W*(please\s+)?(commit|push|pull|merge|rebase|stage|amend|squash|tag|release|ship)\b/i;

/** Asks beside the thread's session; `reply` is null with no answer. */
export type PredictAsk = (
  question: string,
  signal: AbortSignal,
) => Promise<{ reply: string | null; cost?: PredictionAsked["cost"] }>;

/** Whether a turn earns a guess at the message after it. */
export function worthPredicting(request: string, calls: number) {
  if (calls < MIN_CALLS) return false;
  const words = request.trim().split(/\s+/).filter(Boolean).length;
  return !(words <= 6 && CHORE.test(request));
}

/**
 * Watches one turn: once its answer is in, if it did real work, one question
 * beside the session guesses what the person will send next. Asked on the
 * session itself, it reads the thread from the prompt cache it just warmed.
 */
export class TurnPredictor {
  private calls = new Set<string>();
  private done = false;

  constructor(
    private predict: AgentPredict,
    private ask: PredictAsk,
    private signal: AbortSignal,
  ) {}

  /** The main agent made these calls; repeats of an id count once. */
  called(ids: string[]) {
    for (const id of ids) this.calls.add(id);
  }

  /** The turn finished; asks at most once. */
  ended() {
    if (this.done || this.signal.aborted) return;
    this.done = true;
    if (!worthPredicting(this.predict.request, this.calls.size)) return;
    void this.ask(predictionPrompt, this.signal)
      .then(({ reply, cost }) => {
        const next = reply && parsePrediction(reply);
        const offered = !!next && !this.signal.aborted;
        if (offered) this.predict.onPrediction(next);
        this.predict.onAsked?.({ offered, ...(cost ? { cost } : {}) });
      })
      .catch((e) => console.warn("Could not guess the next message:", e));
  }
}
