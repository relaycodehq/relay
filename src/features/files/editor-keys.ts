import type { KeyboardEvent } from "react";
import { matches } from "../../lib/shortcuts";
import { indentedNewline } from "./newline-indent";
import type { FileEditor } from "./useEditableDiff";

type Lookup = "definition" | "references";

/**
 * The editor's own keys, heard before it: the symbol lookups at the caret
 * (1-based), and Enter matching the file's indentation.
 */
export const editorKeys =
  (
    editor: () => FileEditor | undefined,
    lookupAt: (line: number, column: number, kind: Lookup) => void,
  ) =>
  (event: KeyboardEvent<HTMLElement>) => {
    const lookup = matches("references", event)
      ? "references"
      : matches("definition", event)
        ? "definition"
        : undefined;
    if (lookup) {
      const caret = editor()?.getViewState().selections?.[0]?.start;
      if (caret) {
        event.preventDefault();
        event.stopPropagation();
        lookupAt(caret.line + 1, caret.character + 1, lookup);
      }
      return;
    }
    const target = event.nativeEvent.composedPath()[0];
    if (
      event.key !== "Enter" ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      !(target instanceof HTMLElement) ||
      !target.isContentEditable
    )
      return;
    const current = editor();
    const selections = current?.getViewState().selections;
    if (!current || selections?.length !== 1) return;
    const { start, end } = selections[0];
    if (start.line !== end.line || start.character !== end.character) return;
    const { text, caret } = indentedNewline(current.getText(), start);
    event.preventDefault();
    event.stopPropagation();
    current.applyEdits([{ range: { start, end }, newText: text }]);
    current.setSelections([{ start: caret, end: caret, direction: "none" }]);
  };
