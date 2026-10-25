import { lineChangesOf, linesOf } from "./line-changes";

/**
 * Off the main thread: a file rewritten throughout takes most of a second.
 * The committed text comes once, with the first buffer compared to it.
 */
let committed: string[] = [];
self.onmessage = (
  event: MessageEvent<{ committed?: string; buffer: string }>,
) => {
  if (event.data.committed !== undefined)
    committed = linesOf(event.data.committed);
  self.postMessage(lineChangesOf(committed, linesOf(event.data.buffer)));
};
