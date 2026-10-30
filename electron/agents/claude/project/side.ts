import { withTimeout } from "../../../util/timeout";
import type { ClaudeStream } from "./sdk";
import type { SessionTotals } from "../watch/spend";

/** The SDK doesn't type `askSideQuestion` yet. */
type SideAsking = ClaudeStream & {
  askSideQuestion(
    question: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ response: string } | null>;
};

/** A side question to a live session, mid-turn included; null with no answer. */
export async function askLive(
  stream: ClaudeStream,
  question: string,
  signal: AbortSignal,
): Promise<string | null> {
  const answer = await (stream as SideAsking).askSideQuestion(question, {
    signal,
  });
  return answer?.response.trim() || null;
}

/** What the session has spent so far, side questions included. */
export async function sessionTotals(
  stream: ClaudeStream,
): Promise<SessionTotals> {
  const { session } = await withTimeout(
    stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    }),
    5000,
    "Claude did not report usage.",
  );
  return { usd: session.total_cost_usd, models: session.model_usage };
}
