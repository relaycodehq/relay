import type { EditorState, SelectionRange } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";

/** Past this many the count reads "10000+": every keystroke in the field counts again. */
export const MATCH_CAP = 10_000;

/** Where each match starts, in order. */
export type Matches = { starts: number[]; capped: boolean };

export function findMatches(state: EditorState, query: SearchQuery): Matches {
  const starts: number[] = [];
  if (!query.valid) return { starts, capped: false };
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (starts.length === MATCH_CAP) return { starts, capped: true };
    starts.push(next.value.from);
  }
  return { starts, capped: false };
}

/** The 1-based number of the match the selection covers, or 0 when it covers none. */
export function matchNumber(starts: readonly number[], selection: SelectionRange) {
  if (selection.empty) return 0;
  let low = 0,
    high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (starts[mid] === selection.from) return mid + 1;
    if (starts[mid] < selection.from) low = mid + 1;
    else high = mid - 1;
  }
  return 0;
}

/** The first match at or after `from`, else the first in the file. */
export function matchFrom(state: EditorState, query: SearchQuery, from: number) {
  const after = query.getCursor(state, from).next();
  if (!after.done) return after.value;
  const first = query.getCursor(state).next();
  return first.done ? undefined : first.value;
}

/** What the bar says about the matches, as PhpStorm does: "3/12", "12 results", "0 results". */
export function matchCount(query: SearchQuery, matches: Matches, current: number) {
  if (query.search && !query.valid) return "Bad pattern";
  const total = `${matches.starts.length}${matches.capped ? "+" : ""}`;
  if (current) return `${current}/${total}`;
  return matches.starts.length === 1 ? "1 result" : `${total} results`;
}
