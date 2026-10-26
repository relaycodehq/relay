import { countColumn, type Text } from "@codemirror/state";

/**
 * A line's indent in columns, or null for a blank line, which takes its
 * neighbours'. The ` * ` lines of a block comment count from its `/*`; their
 * extra space only lines the stars up.
 */
export function indentOf(text: string, tabSize: number) {
  const code = text.trimStart();
  if (!code) return null;
  const indent = countColumn(text, tabSize, text.length - code.length);
  const commentStar = code.startsWith("*") && indent > 0;
  return commentStar ? indent - 1 : indent;
}

/**
 * The guide columns each line of `from`..`to` (1-based) gets, as PhpStorm
 * draws them: one at the indent of each line it's nested under, so a block
 * indented by 4 in a file of 2s gets one guide, not two. A blank line keeps
 * the guides both its neighbours share, so a block's guide runs through its
 * empty lines; `look` caps how far it searches for them and for the lines
 * the first one is nested under.
 */
export function guideColumns(doc: Text, from: number, to: number, tabSize: number, look = 1000) {
  const indentAt = (line: number) => indentOf(doc.line(line).text, tabSize);
  const nearest = (line: number, step: 1 | -1) => {
    for (let n = line + step, i = 0; n >= 1 && n <= doc.lines && i < look; n += step, i++) {
      const indent = indentAt(n);
      if (indent !== null) return indent;
    }
    return 0;
  };
  // The indents of the lines the next line may be nested under, outermost first.
  const open = linesAbove(from, indentAt, look);
  const columns: number[][] = [];
  for (let line = from; line <= to; line++) {
    const own = indentAt(line);
    if (own === null) {
      const indent = Math.min(nearest(line, -1), nearest(line, 1));
      columns.push(open.filter((column) => column < indent));
      continue;
    }
    while (open.length && open[open.length - 1] >= own) open.pop();
    columns.push([...open]);
    open.push(own);
  }
  return columns;
}

/** The indents of the lines above `line` that a line below them is nested under: each the nearest with less indent. */
function linesAbove(line: number, indentAt: (line: number) => number | null, look: number) {
  const found: number[] = [];
  let under = Infinity;
  for (let n = line - 1, i = 0; n >= 1 && i < look && under > 0; n--, i++) {
    const indent = indentAt(n);
    if (indent === null || indent >= under) continue;
    found.unshift(indent);
    under = indent;
  }
  return found;
}
