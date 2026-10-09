import type { ChatMessage } from "../../../shared/projects";

export const pinSlack = 48;

/** Anchor above the active answer, including when a newer steer precedes it. */
export function scrollAnchor(messages: readonly Pick<ChatMessage, "status">[]) {
  const growing = messages.findIndex((message) => message.status === "streaming");
  // Older growing roots above this answer must not add their height changes
  // to its compensation. The next row's origin accounts for this answer.
  return growing < 0 ? Math.min(1, messages.length) : growing + 1;
}

/** Undefined means there is no resize to compensate, or the reader is pinned. */
export function offsetAfterResize(offset: number, previous: number | undefined, height: number) {
  if (previous === undefined || previous === height || offset <= pinSlack) return;
  return Math.max(0, offset + previous - height);
}
