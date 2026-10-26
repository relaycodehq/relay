import { Change, diff } from "@codemirror/merge";
import { diffArrays } from "diff";

// Past this many differing lines, the texts count as rewritten and get the merge view's own rough diff.
const MAX_EDIT_LINES = 2000;
// The merge view's default: a run of lines this different is shown replaced whole.
const WITHIN_LINES = { scanLimit: 500 };

/** Each line of `text` with its line break, so their lengths add up to the text's. */
const linesOf = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

const lengthOf = (lines: readonly string[]) => lines.reduce((sum, line) => sum + line.length, 0);

/**
 * How `b` differs from `a`: which lines changed, as Git would say, then which
 * characters within them. The merge view's own diff gives up on long texts
 * changed in several places and calls all of it replaced; this one doesn't.
 */
export function lineFirstDiff(a: string, b: string): readonly Change[] {
  const parts = diffArrays(linesOf(a), linesOf(b), { maxEditLength: MAX_EDIT_LINES });
  if (!parts) return diff(a, b, WITHIN_LINES);
  const changes: Change[] = [];
  let posA = 0;
  let posB = 0;
  for (let i = 0; i < parts.length; ) {
    if (!parts[i].added && !parts[i].removed) {
      const length = lengthOf(parts[i].value);
      posA += length;
      posB += length;
      i++;
      continue;
    }
    // Removed lines and the ones added in their place are one replacement.
    let removed = 0;
    let added = 0;
    for (; i < parts.length && (parts[i].added || parts[i].removed); i++) {
      if (parts[i].removed) removed += lengthOf(parts[i].value);
      else added += lengthOf(parts[i].value);
    }
    const within = diff(a.slice(posA, posA + removed), b.slice(posB, posB + added), WITHIN_LINES);
    for (const c of within)
      changes.push(new Change(c.fromA + posA, c.toA + posA, c.fromB + posB, c.toB + posB));
    posA += removed;
    posB += added;
  }
  return changes;
}
