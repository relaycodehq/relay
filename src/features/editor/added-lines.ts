import { getChunks } from "@codemirror/merge";
import {
  RangeSetBuilder,
  StateField,
  type EditorState,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

const wholeLine = Decoration.line({ class: "cm-wholeChange" });

const wordChar = /[\p{L}\p{N}_$]/u;

/**
 * Whether a line was rewritten whole: nothing of it is left unchanged but
 * spaces and punctuation, like a `);` the diff happened to match elsewhere.
 * A line of punctuation alone, like `});`, counts its marks instead.
 */
export function changedWhole(text: string, changedAt: (at: number) => boolean) {
  const counts = wordChar.test(text) ? (char: string) => wordChar.test(char) : (char: string) => char.trim() !== "";
  for (let at = 0; at < text.length; at++)
    if (!changedAt(at) && counts(text[at])) return false;
  return true;
}

function wholeLines(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const chunk of getChunks(state)?.chunks ?? []) {
    if (chunk.fromB === chunk.toB) continue;
    // The chunk's changes, in the document's positions, in order.
    const changes = chunk.changes.map((c) => [
      chunk.fromB + c.fromB,
      chunk.fromB + c.toB,
    ]);
    let first = 0;
    const last = state.doc.lineAt(Math.max(chunk.fromB, chunk.toB - 1)).number;
    for (let n = state.doc.lineAt(chunk.fromB).number; n <= last; n++) {
      const line = state.doc.line(n);
      while (first < changes.length && changes[first][1] <= line.from) first++;
      const onLine: number[][] = [];
      for (let i = first; i < changes.length && changes[i][0] < line.to; i++)
        onLine.push(changes[i]);
      const changedAt = (at: number) =>
        onLine.some(
          ([from, to]) => line.from + at >= from && line.from + at < to,
        );
      if (changedWhole(line.text, changedAt))
        builder.add(line.from, line.from, wholeLine);
    }
  }
  return builder.finish();
}

/**
 * Lines added or rewritten whole keep only their tint, as in VS Code and
 * JetBrains. The merge view underlines every changed character, which says
 * something within an edited line and nothing but noise on a new one.
 */
export const addedLines = [
  StateField.define<DecorationSet>({
    create: wholeLines,
    update(deco, tr) {
      const chunksMoved =
        getChunks(tr.state)?.chunks !== getChunks(tr.startState)?.chunks;
      return chunksMoved ? wholeLines(tr.state) : deco.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  }),
  EditorView.baseTheme({
    ".cm-wholeChange .cm-changedText": { background: "none !important" },
  }),
];
