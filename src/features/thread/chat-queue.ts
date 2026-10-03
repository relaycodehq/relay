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
