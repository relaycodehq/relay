import { highlightingFor, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";

/** How wide a character is on the minimap, in px. */
export const CHAR_PX = 0.8;

/** A run of characters drawn as one dash: from which column, how many, and the highlight classes it has. */
export type Dash = { column: number; length: number; classes: string };

/**
 * The dashes of lines `first`..`last`: each run of non-blank characters
 * that share a colour, tabs counted by the tab size, as the editor colours
 * them from what of the file is parsed so far. A line stops at `columns`,
 * past which nothing is drawn.
 */
export function lineDashes(
  state: EditorState,
  first: number,
  last: number,
  columns = Infinity,
): Dash[][] {
  const from = state.doc.line(first).from;
  const to = state.doc.line(last).to;
  const tokens: { from: number; to: number; classes: string }[] = [];
  highlightTree(
    syntaxTree(state),
    { style: (tags) => highlightingFor(state, tags) },
    (start, end, classes) => tokens.push({ from: start, to: end, classes }),
    from,
    to,
  );
  const dashes: Dash[][] = [];
  let token = 0;
  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number);
    const runs: Dash[] = [];
    let column = 0;
    for (let at = line.from; at < line.to && column < columns; at++) {
      const char = line.text[at - line.from];
      if (char === "\t") {
        column += state.tabSize - (column % state.tabSize);
        continue;
      }
      while (token < tokens.length && tokens[token].to <= at) token++;
      const classes = token < tokens.length && tokens[token].from <= at ? tokens[token].classes : "";
      const last = runs[runs.length - 1];
      if (char === " ") column++;
      else if (last && last.classes === classes && last.column + last.length === column) {
        last.length++;
        column++;
      } else runs.push({ column: column++, length: 1, classes });
    }
    dashes.push(runs);
  }
  return dashes;
}

/** Draws the dashes, line `first` at the top, each in its colour; `columns` caps how far right they go. */
export function paintDashes(
  context: CanvasRenderingContext2D,
  dashes: readonly Dash[][],
  top: number,
  lineHeight: number,
  columns: number,
  colourOf: (classes: string) => string,
) {
  // A dense page's lines run together; a sparse one keeps a gap between them.
  const dashHeight = lineHeight < 1 ? lineHeight : lineHeight * 0.75;
  dashes.forEach((runs, i) => {
    const y = top + i * lineHeight;
    for (const dash of runs) {
      if (dash.column >= columns) break;
      context.fillStyle = colourOf(dash.classes);
      const length = Math.min(dash.length, columns - dash.column);
      context.fillRect(dash.column * CHAR_PX, y, length * CHAR_PX, dashHeight);
    }
  });
}
