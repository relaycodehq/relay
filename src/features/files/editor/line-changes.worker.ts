import { lineChanges } from "./line-changes";

/** Off the main thread: a file rewritten throughout takes most of a second. */
self.onmessage = (
  event: MessageEvent<{ id: number; committed: string; buffer: string }>,
) => {
  const { id, committed, buffer } = event.data;
  self.postMessage({ id, hunks: lineChanges(committed, buffer) });
};
