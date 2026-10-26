import { getChunks, getOriginalDoc, type Chunk } from "@codemirror/merge";
import { Text, type EditorState } from "@codemirror/state";
import { comparedText, inlineBars, workedHunks } from "../change-gutter";
import type { LineHunk } from "../line-changes";

/**
 * One change against the compared text, in the editor's 1-based lines:
 * `added` lines from `line` took the place of `removed` compared lines from
 * `oldLine`. No `added` means lines were removed just before `line`.
 */
export type FileChange = { line: number; added: number; oldLine: number; removed: number };

/** The compared text as the editor splits it into lines. */
export const comparedDoc = (state: EditorState) => {
  if (state.field(inlineBars, false)) return getOriginalDoc(state);
  const text = state.facet(comparedText);
  return text === undefined ? undefined : Text.of(text.split(/\r?\n/));
};

/**
 * The file's changes in order, as the bars show them: the inline view's
 * chunks while it is on, else the worker's hunks. Undefined while those are
 * catching up with an edit.
 */
export function fileChanges(state: EditorState): FileChange[] | undefined {
  if (state.field(inlineBars, false)) {
    const chunks = getChunks(state)?.chunks;
    return chunks?.map((chunk) => fromChunk(chunk, getOriginalDoc(state), state.doc));
  }
  const hunks = workedHunks(state);
  return hunks && changesOf(hunks);
}

/** What `fileChanges` is worked out from: a new one means the changes may have moved. */
export const changesSource = (state: EditorState) =>
  state.field(inlineBars, false) ? getChunks(state)?.chunks : workedHunks(state);

/** The worker's hunks with where each sits in the compared text. */
export function changesOf(hunks: readonly LineHunk[]): FileChange[] {
  let shift = 0;
  return hunks.map(({ line, added, removed }) => {
    const change = { line, added, oldLine: line + shift, removed };
    shift += removed - added;
    return change;
  });
}

function fromChunk(chunk: Chunk, a: Text, b: Text): FileChange {
  const span = (doc: Text, from: number, to: number) => {
    const first = from > doc.length ? doc.lines + 1 : doc.lineAt(from).number;
    const count = from === to ? 0 : doc.lineAt(Math.min(to - 1, doc.length)).number - first + 1;
    return [first, count];
  };
  const [line, added] = span(b, chunk.fromB, chunk.toB);
  const [oldLine, removed] = span(a, chunk.fromA, chunk.toA);
  return { line, added, oldLine, removed };
}

/** The change whose bar is on `line`: its changed lines, or the lines either side of a removal. */
export function changeOnLine(changes: readonly FileChange[], line: number) {
  return changes.find((change) =>
    change.added
      ? line >= change.line && line < change.line + change.added
      : line === change.line || line === change.line - 1,
  );
}

/** The compared lines a change took out. */
export const removedLines = (compared: Text, change: FileChange) =>
  Array.from({ length: change.removed }, (_, i) => compared.line(change.oldLine + i).text);

/** Lines of a doc, not counting the empty one after a final line break. */
const contentLines = (doc: Text) => (doc.line(doc.lines).length ? doc.lines : doc.lines - 1);

/**
 * The change stretched to the end of both texts when it reaches the end of
 * either, so it carries whether the file ends with a line break: the worker
 * leaves that empty last line out of its hunks.
 */
function toTheEnd(change: FileChange, compared: Text, buffer: Text): FileChange {
  const reachesEnd =
    change.line - 1 + change.added >= contentLines(buffer) ||
    change.oldLine - 1 + change.removed >= contentLines(compared);
  if (!reachesEnd) return change;
  return {
    ...change,
    added: buffer.lines - change.line + 1,
    removed: compared.lines - change.oldLine + 1,
  };
}

/**
 * The compared text with just this change of the buffer's made, byte for byte
 * elsewhere: what committing only this change stores. Its new lines take the
 * compared text's line breaks.
 */
export function comparedWith(compared: string, buffer: Text, lineBreak: string, change: FileChange) {
  const old = compared.split("\n");
  const { line, added, oldLine, removed } = toTheEnd(change, Text.of(old), buffer);
  const crlf = compared ? compared.includes("\r\n") : lineBreak === "\r\n";
  const fresh = Array.from({ length: added }, (_, i) => buffer.line(line + i).text);
  const before = old.slice(0, oldLine - 1);
  const after = old.slice(oldLine - 1 + removed);
  // Every new line is followed by another except the very last one.
  const freshText = fresh.map((text, i) => {
    const last = i === fresh.length - 1 && !after.length;
    return crlf && !last ? `${text}\r` : text;
  });
  return [...before, ...freshText, ...after].join("\n");
}

/** The edit that puts the compared lines back in place of this change in the buffer. */
export function rollbackEdit(compared: Text, buffer: Text, lineBreak: string, change: FileChange) {
  const { line, added, oldLine, removed } = toTheEnd(change, compared, buffer);
  const old = Array.from({ length: removed }, (_, i) => compared.line(oldLine + i).text);
  const from = line <= buffer.lines ? buffer.line(line).from : buffer.length;
  const toEnd = line + added > buffer.lines;
  const to = toEnd ? buffer.length : buffer.line(line + added).from;
  if (toEnd && line > buffer.lines) return { from, to, insert: lineBreak + old.join(lineBreak) };
  const insert = toEnd ? old.join(lineBreak) : old.map((text) => text + lineBreak).join("");
  return { from, to, insert };
}
