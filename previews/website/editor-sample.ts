// The file the tour's editor shows, and what the language server would say
// about it. Sample code: nothing here is read from a real project.
export const path = "src/lib/queue.ts";

export const code = `import { clamp } from "./numbers";

export interface Queued {
  id: string;
  text: string;
}

/** Moves one queued message to a new place. */
export function reorder(
  queue: Queued[],
  from: number,
  to: number,
) {
  const next = [...queue];
  const [moved] = next.splice(from, 1);
  next.splice(clamp(to, 0, next.length), 0, moved);
  return next;
}

export function moveUp(queue: Queued[], id: string) {
  const at = queue.findIndex((item) => item.id === id);
  return reorder(queue, at, at - 1);
}

export function moveDown(queue: Queued[], id: string) {
  const at = queue.findIndex((item) => item.id === id);
  return reorder(queue, at, "next");
}

export function remove(queue: Queued[], id: string) {
  return queue.filter((item) => item.id !== id);
}

export function replace(queue: Queued[], id: string, text: string) {
  return queue.map((item) => (item.id === id ? { ...item, text } : item));
}

export function first(queue: Queued[]) {
  return queue[0];
}

export function isEmpty(queue: Queued[]) {
  return queue.length === 0;
}
`;

/** The call the hover and the usages are about, and the argument that is wrong. */
export const symbol = { text: "reorder(queue, at, at - 1)", word: "reorder" };
export const mistake = '"next"';

export const hover =
  "```typescript\n(function) reorder(queue: Queued[], from: number, to: number): Queued[]\n```\nMoves one queued message to a new place.\n\n*@param* `to` — where it goes";

export const errorText =
  "Argument of type 'string' is not assignable to parameter of type 'number'.";

export const usages = [
  { path: "src/lib/queue.ts", line: 9, preview: "export function reorder(" },
  { path: "src/lib/queue.ts", line: 22, preview: "return reorder(queue, at, at - 1);" },
  { path: "src/lib/queue.ts", line: 27, preview: 'return reorder(queue, at, "next");' },
  { path: "src/features/thread/ProjectChat.tsx", line: 212, preview: "setQueue(reorder(queue, from, to));" },
];
