import type { DeepReviewState } from "../../../shared/deep-review";
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
  const roundOf = new Map<string, DeepReviewState>();
  const leadOf = new Map<DeepReviewState, ChatMessage>();
  let current: DeepReviewState | undefined;
  for (const m of messages) {
    if (m.parentId || m.side) continue;
    current = byRequest.get(m.id) ?? current;
    if (!current) continue;
    roundOf.set(m.id, current);
    if (m.role === "assistant" && !leadOf.has(current)) leadOf.set(current, m);
  }
  return {
    /** The round whose request this message is. */
    asked: (id: string) => byRequest.get(id),
    roundOf: (id: string) => roundOf.get(id),
    leadOf: (round: DeepReviewState) => leadOf.get(round),
  };
}
