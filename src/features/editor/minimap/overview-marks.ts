import { forEachDiagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import { comparedText } from "../change-gutter";
import { fileChanges, type FileChange } from "../change-popup/file-changes";

export type MarkKind = "added" | "modified" | "removed" | "error" | "warning";

/** A mark on the file's stripe: what it is, the lines it covers, and what it says on hover. */
export type OverviewMark = { kind: MarkKind; line: number; lines: number; label: string };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The file's changes against the compared text, as PhpStorm marks them beside the scrollbar. */
export function changeMarks(changes: readonly FileChange[]): OverviewMark[] {
  return changes.map(({ line, added, removed }) => {
    if (!removed) return { kind: "added", line, lines: added, label: `${plural(added, "line")} added` };
    if (!added) return { kind: "removed", line, lines: 0, label: `${plural(removed, "line")} removed` };
    return { kind: "modified", line, lines: added, label: `${plural(added, "line")} changed` };
  });
}

/** The file's errors and warnings; notes and hints get no mark. */
export function diagnosticMarks(state: EditorState): OverviewMark[] {
  const marks: OverviewMark[] = [];
  forEachDiagnostic(state, (diagnostic, from, to) => {
    if (diagnostic.severity !== "error" && diagnostic.severity !== "warning") return;
    const line = state.doc.lineAt(from).number;
    const lines = state.doc.lineAt(to).number - line + 1;
    marks.push({ kind: diagnostic.severity, line, lines, label: diagnostic.message.split("\n")[0] });
  });
  return marks;
}

/**
 * Every mark of the file: changes under problems, so a problem on a changed
 * line still shows. Undefined while the changes are being worked out after an
 * edit, so the stripe keeps the marks it has instead of emptying for a moment.
 */
export function overviewMarks(state: EditorState): OverviewMark[] | undefined {
  const changes = fileChanges(state);
  const comparing = state.facet(comparedText) !== undefined;
  if (comparing && !changes) return undefined;
  return [...changeMarks(changes ?? []), ...diagnosticMarks(state)];
}

/**
 * Where a mark sits on a stripe `height` px tall that stands for the whole
 * file, as PhpStorm's does: at least `least` px, so a one-line change in a
 * long file still shows.
 */
export function stripeSpan(mark: OverviewMark, fileLines: number, height: number, least = 3) {
  const perLine = height / Math.max(fileLines, 1);
  const top = (mark.line - 1) * perLine;
  const span = Math.max(mark.lines * perLine, least);
  return { top: Math.min(top, height - span), height: span };
}
