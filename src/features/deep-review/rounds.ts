import {
  messageRounds,
  type DeepReviewState,
} from "../../../shared/deep-review";
import type { ChatMessage } from "../../../shared/projects";

/**
 * Where each review round sits in the thread: the round a main message falls
 * in, the latest one asked for before it, and the lead's first answer to
 * each round.
 */
export function reviewRounds(
  messages: ChatMessage[],
  reviews: DeepReviewState[] | undefined,
) {
  const byRequest = new Map(reviews?.map((r) => [r.request, r]));
  const roundOf = messageRounds(messages, reviews);
  const leadOf = new Map<DeepReviewState, ChatMessage>();
  for (const m of messages) {
    const round = roundOf.get(m.id);
    if (!round || leadOf.has(round)) continue;
    if (
      round.leadAnswer
        ? m.id === round.leadAnswer
        : // Saved before rounds named it; a round whose lead hasn't started has none.
          m.role === "assistant" && savedBeforeLeadAnswer(round)
    )
      leadOf.set(round, m);
  }
  return {
    /** The round whose request this message is. */
    asked: (id: string) => byRequest.get(id),
    roundOf: (id: string) => roundOf.get(id),
    leadOf: (round: DeepReviewState) => leadOf.get(round),
  };
}

/** A round whose lead ran before rounds named its answer. */
const savedBeforeLeadAnswer = (round: DeepReviewState) =>
  round.status === "leading" || round.status === "done" || !!round.leadStopped;
