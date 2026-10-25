import type { Text } from "@codemirror/state";

/** A 0-based line and character (as a language server or the checks give them) as an offset in `doc`, clamped to it. */
export function offsetAt(doc: Text, line: number, character: number) {
  if (line >= doc.lines) return doc.length;
  const at = doc.line(Math.max(line, 0) + 1);
  return Math.min(at.from + Math.max(character, 0), at.to);
}

/** An offset in `doc` as a 0-based line and character. */
export function positionAt(doc: Text, offset: number) {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}
