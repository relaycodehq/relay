/** Where a dragged queued message is dropped: before or after another. */
export type QueueDrop = { id: string; where: "before" | "after" };

/** The queue with `moving` dropped on `target`, and the index it lands at; nothing when it stays put. */
export function moveQueued<T extends { input: { id: string } }>(
  queue: T[],
  moving: string,
  target: QueueDrop,
) {
  if (target.id === moving) return;
  const rest = queue.filter((q) => q.input.id !== moving),
    index =
      rest.findIndex((q) => q.input.id === target.id) +
      (target.where === "after" ? 1 : 0);
  if (queue.findIndex((q) => q.input.id === moving) === index) return;
  return {
    index,
    queue: [
      ...rest.slice(0, index),
      queue.find((q) => q.input.id === moving)!,
      ...rest.slice(index),
    ],
  };
}

/**
 * The newest message queued in conversation `rootId`. A queued compaction
 * isn't one: it has nothing to take back, and goes ahead of older messages.
 */
export function newestQueued<
  T extends { input: I; created: number; compact?: boolean },
  I,
>(
  queue: T[],
  rootId: string | null,
  conversationOf: (input: I) => string | null,
) {
  let last: T | undefined;
  for (const queued of queue)
    if (
      !queued.compact &&
      conversationOf(queued.input) === rootId &&
      (!last || queued.created >= last.created)
    )
      last = queued;
  return last;
}
