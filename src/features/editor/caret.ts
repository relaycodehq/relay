import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Puts the caret at a 1-based line and column, clamped to the file, and scrolls it to the middle. */
export function moveCaretTo(view: EditorView, line: number, column = 1) {
  const { doc } = view.state;
  const at = doc.line(Math.max(1, Math.min(line, doc.lines)));
  const pos = Math.min(at.from + column - 1, at.to);
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  });
}
