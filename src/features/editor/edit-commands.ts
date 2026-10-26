import { copyLineDown } from "@codemirror/commands";
import { EditorSelection, type StateCommand } from "@codemirror/state";
import type { Command } from "@codemirror/view";

/** ⌘D: the line again below it, or the selection again after itself. */
export const duplicate: Command = (view) => {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.every((r) => r.empty)) return copyLineDown(view);
  view.dispatch(
    state.changeByRange((range) =>
      range.empty
        ? { range }
        : {
            changes: { from: range.to, insert: state.sliceDoc(range.from, range.to) },
            range: EditorSelection.range(range.to, range.to + range.to - range.from),
          },
    ),
    { scrollIntoView: true, userEvent: "input.copyline" },
  );
  return true;
};

/**
 * ⌃⇧G: drop the occurrence ⌃G added last. ⌃G keeps the first selection as
 * the main one and adds each next match after the others, so the one to drop
 * is the last, or the one just before the main once the search wrapped.
 */
export const unselectOccurrence: StateCommand = ({ state, dispatch }) => {
  const { ranges, mainIndex } = state.selection;
  if (ranges.length < 2) return false;
  const last = ranges.length - 1;
  const dropped = last === mainIndex ? mainIndex - 1 : last;
  const kept = ranges.filter((_, i) => i !== dropped);
  const main = dropped < mainIndex ? mainIndex - 1 : mainIndex;
  dispatch(
    state.update({
      selection: EditorSelection.create(kept, main),
      scrollIntoView: true,
      userEvent: "select",
    }),
  );
  return true;
};

/** ⌘⌥⏎: a new line above the caret's, indented like it. */
export const newLineAbove: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.head);
        const indent = /^\s*/.exec(line.text)![0];
        return {
          changes: { from: line.from, insert: indent + state.lineBreak },
          range: EditorSelection.cursor(line.from + indent.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
};

/** ⌃⇧J: the next line pulled up onto this one, one space between. */
export const joinLines: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const changes = state.changeByRange((range) => {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    const end = last.number > first.number ? last.number : first.number + 1;
    if (end > state.doc.lines) return { range };
    const edits = [];
    for (let n = first.number; n < end; n++) {
      const line = state.doc.line(n);
      const next = state.doc.line(n + 1);
      const trailing = line.text.length - line.text.trimEnd().length;
      const leading = next.text.length - next.text.trimStart().length;
      edits.push({
        from: line.to - trailing,
        to: next.from + leading,
        insert: next.text.trim() && line.text.trim() ? " " : "",
      });
    }
    const join = edits[0];
    return {
      changes: edits,
      range: EditorSelection.cursor(join.from),
    };
  });
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/** ⌘⇧U: upper case, or lower when it already is. */
export const toggleCase: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly || state.selection.ranges.every((r) => r.empty))
    return false;
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to);
        const next =
          text === text.toUpperCase() ? text.toLowerCase() : text.toUpperCase();
        return {
          changes: { from: range.from, to: range.to, insert: next },
          range,
        };
      }),
      { userEvent: "input" },
    ),
  );
  return true;
};
