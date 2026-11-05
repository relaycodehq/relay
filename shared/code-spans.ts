export type CodeSpan = { index: number; text: string };

const LINE_BREAK = /[\n\r\u2028\u2029]/g;

/**
 * The code spans in `line`, as `/(`+)(?:[^`]|[^`].*?[^`])\1(?!`)/g` finds
 * them, in linear time: that expression retries every backtick of an
 * unclosed run against the rest of the line, so a long run took quadratic
 * time on each streamed update.
 *
 * A span opens with the tail of a run of backticks and closes at the next
 * run of exactly that length. The text between holds no line break, except
 * as its first or last character.
 */
export function codeSpans(line: string): CodeSpan[] {
  const runs = backtickRuns(line);
  const later = laterRunFinder(runs);
  const lineBreakAfter = lineBreakFinder(line);
  const spans: CodeSpan[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const end = run.start + run.length;
    if (end >= line.length) break;
    const lastAllowed = lineBreakAfter(end + 1) + 1;
    for (let length = run.length; length > 0; length--) {
      const close = later(length, end);
      if (!close || close.start > lastAllowed) continue;
      const index = end - length;
      spans.push({ index, text: line.slice(index, close.start + length) });
      while (runs[i + 1] && runs[i + 1]!.start <= close.start) i++;
      break;
    }
  }
  return spans;
}

type Run = { start: number; length: number };

function backtickRuns(line: string): Run[] {
  const runs: Run[] = [];
  for (let at = line.indexOf("`"); at >= 0;) {
    let end = at;
    while (line[end] === "`") end++;
    runs.push({ start: at, length: end - at });
    at = line.indexOf("`", end);
  }
  return runs;
}

/**
 * Finds the first run of a given length starting after a position. The
 * positions asked about only grow, so each length's runs are read once.
 */
function laterRunFinder(runs: Run[]) {
  const byLength = new Map<number, { runs: Run[]; next: number }>();
  for (const run of runs) {
    const entry = byLength.get(run.length) ?? { runs: [], next: 0 };
    entry.runs.push(run);
    byLength.set(run.length, entry);
  }
  return (length: number, after: number): Run | undefined => {
    const entry = byLength.get(length);
    if (!entry) return undefined;
    while (entry.runs[entry.next] && entry.runs[entry.next]!.start <= after)
      entry.next++;
    return entry.runs[entry.next];
  };
}

/**
 * Finds the first line break at or after a position, or the line's length.
 * The positions asked about only grow, so it remembers the last one found.
 */
function lineBreakFinder(line: string) {
  let found = -1;
  return (from: number): number => {
    if (found >= from) return found;
    LINE_BREAK.lastIndex = from;
    found = LINE_BREAK.exec(line)?.index ?? line.length;
    return found;
  };
}
