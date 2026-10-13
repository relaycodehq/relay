import type { ChatMessage } from "../../../shared/projects";

/**
 * The answer the lead's first turn stopped on (`leadStopped`, the latest one
 * after a resume) is still the newest thing in the main conversation, so
 * resuming the lead is still the way on. Once the user or the lead says
 * anything more, the thread has moved past it.
 */
export function leadStoppedLast(
  messages: ChatMessage[],
  leadStopped: string | undefined,
) {
  const main = messages.filter((m) => !m.parentId && !m.side);
  // Saved before reviews recorded it: the lead's first answer.
  const stopped = leadStopped ?? main.find((m) => m.role === "assistant")?.id;
  const last = main.at(-1);
  return (
    !!stopped &&
    last?.id === stopped &&
    (last.status === "cancelled" || last.status === "failed")
  );
}
