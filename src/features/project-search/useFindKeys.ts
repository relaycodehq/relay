import type { KeyboardEvent, RefObject } from "react";
import type { OpenTarget } from "./types";
import type { SearchFlags } from "./search-options";
import { flagShortcut } from "./SearchToggles";
import type { ResultTree } from "./useResultTree";

/**
 * The panel's keys: Alt+C/W/R for the switches, Esc to close, arrows and
 * Enter to move through and open the matches. Outside the text fields, Left
 * and Right fold a file and Delete leaves it out of a replace.
 */
export function useFindKeys(panel: {
  findInput: RefObject<HTMLInputElement | null>;
  toggle: Record<keyof SearchFlags, () => void>;
  tree: ResultTree;
  onOpen: (target: OpenTarget) => void;
  onClose: () => void;
}) {
  const { findInput, toggle, tree, onOpen, onClose } = panel;
  return function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.nativeEvent.isComposing) return;
    if (flagShortcut(e, toggle)) return e.preventDefault();
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return onClose();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      return tree.moveSelection(
        tree.selectedIndex + (e.key === "ArrowDown" ? 1 : -1),
      );
    }
    // A field or button keeps its own keys: Enter on Replace All replaces, not opens.
    const inControl =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLButtonElement;
    const fromFindField = e.target === findInput.current;
    if (e.key === "Enter" && (fromFindField || !inControl)) {
      e.preventDefault();
      const target = tree.openTargetAt(tree.selectedIndex);
      if (target) onOpen(target);
      return;
    }
    const row = tree.selectedRow;
    if (inControl || !row) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      tree.toggleLeftOut(row.file.path);
    } else if (row.kind === "file") {
      if (e.key === "ArrowLeft") tree.fold(row.file.path, true);
      if (e.key === "ArrowRight") tree.fold(row.file.path, false);
    }
  };
}
