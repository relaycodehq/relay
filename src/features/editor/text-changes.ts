import { ChangeSet, type EditorState } from "@codemirror/state";

/**
 * The line break a file keeps: CRLF when every break is one, else LF, with
 * any stray CR left in the text as it was. Saving writes the same bytes back.
 */
export const lineBreakOf = (text: string) =>
  /\r\n/.test(text) && !/(^|[^\r])\n/.test(text) ? "\r\n" : "\n";

/** The shortest change from `state`'s text to `to`: one edit between their common ends. */
export function minimalChange(state: EditorState, to: string) {
  const next = state.toText(to);
  const a = state.doc.toString();
  const b = next.toString();
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < max - start &&
    a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)
  )
    end++;
  return ChangeSet.of(
    { from: start, to: a.length - end, insert: next.slice(start, b.length - end) },
    a.length,
  );
}
