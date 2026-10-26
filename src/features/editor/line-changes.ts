import { diffArrays } from "diff";

/**
 * A run of edited lines: `added` lines of the buffer from `line` (1-based)
 * took the place of `removed` committed ones. Neither zero means modified; no
 * `added` means lines were removed just before `line`.
 */
export type LineHunk = { line: number; added: number; removed: number };

// Past this many differing lines, diffing gives up and the whole differing middle counts as one change.
const MAX_EDIT = 4000;

// Added to a last line that has no newline at its end. A split line can never contain one, so it can't match a line that has it.
const NO_EOL = "\n";

/**
 * A text's lines as compared: no final empty line and no CR, but a last line
 * missing its newline differs from the same line with one, as Git sees it.
 */
export const linesOf = (text: string) => {
  const lines = text.split("\n");
  const ended = lines.at(-1) === "";
  if (ended) lines.pop();
  // A CRLF file over an LF commit (autocrlf) isn't a change on every line.
  const plain = lines.map((line) =>
    line.endsWith("\r") ? line.slice(0, -1) : line,
  );
  if (!ended) plain[plain.length - 1] += NO_EOL;
  return plain;
};

/** How the buffer's lines differ from the committed text, as an editor gutter marks them. */
export function lineChanges(committed: string, buffer: string): LineHunk[] {
  return lineChangesOf(linesOf(committed), linesOf(buffer));
}

/** `lineChanges` over lines already split by `linesOf`. */
export function lineChangesOf(
  before: readonly string[],
  after: readonly string[],
): LineHunk[] {
  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  )
    head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  const old = before.slice(head, before.length - tail),
    next = after.slice(head, after.length - tail);
  if (!old.length && !next.length) return [];
  const parts = diffArrays(old, next, { maxEditLength: MAX_EDIT }) ?? [
    { removed: true, added: false, count: old.length, value: old },
    { removed: false, added: true, count: next.length, value: next },
  ];
  const hunks: LineHunk[] = [];
  let line = head + 1;
  let open: LineHunk | undefined;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      open = undefined;
      line += part.count;
      continue;
    }
    if (!open) hunks.push((open = { line, added: 0, removed: 0 }));
    if (part.added) {
      open.added += part.count;
      line += part.count;
    } else open.removed += part.count;
  }
  return hunks;
}

/** The committed line number of a buffer line, or undefined if the line was added or changed since. */
export function committedLine(
  hunks: readonly LineHunk[],
  line: number,
): number | undefined {
  let shift = 0;
  for (const hunk of hunks) {
    if (line < hunk.line) break;
    if (line < hunk.line + hunk.added) return undefined;
    shift += hunk.removed - hunk.added;
  }
  return line + shift;
}
