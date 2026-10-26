import { useState, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { useDoubleShift, type SearchMode } from "../project-search";

/** Asks the Search Everywhere palette to open on `mode`; `key` makes each ask a fresh one. */
export type PaletteRequest = { mode: SearchMode; key: number };

/** Asks Find in Files to open, starting from the editor's selected text if any. */
export type FindRequest = { replace: boolean; query?: string; key: number };

/**
 * The editor's project-wide search: the Search Everywhere palette, Find in
 * Files under the editor, and the `host` commands that open them from the
 * editor's keys. Double Shift opens the palette from anywhere in the pane.
 */
export function useEditorSearch({
  active,
  pane,
}: {
  /** The Files tab is in front. */
  active: boolean;
  pane: RefObject<HTMLElement | null>;
}) {
  const [palette, setPalette] = useState<PaletteRequest>();
  const [finding, setFinding] = useState<FindRequest>();

  // Editor key handlers report that they handled the key by returning true.
  const openPaletteOn = (mode: SearchMode) => () => {
    setPalette({ mode, key: Date.now() });
    return true;
  };
  const openFindInFiles = (replace: boolean) => (view: EditorView) => {
    const { from, to } = view.state.selection.main;
    const hasSelection = from !== to;
    setFinding({
      replace,
      query: hasSelection ? view.state.sliceDoc(from, to) : undefined,
      key: Date.now(),
    });
    return true;
  };

  // Not while the chat beside the files has focus.
  useDoubleShift(() => {
    const focused = document.activeElement;
    const focusIsOutsidePane =
      !!focused &&
      focused !== document.body &&
      !pane.current?.contains(focused);
    if (focusIsOutsidePane) return;
    setPalette({ mode: "all", key: Date.now() });
  }, active && !palette);

  return {
    palette,
    closePalette: () => setPalette(undefined),
    finding,
    closeFinding: () => setFinding(undefined),
    host: {
      searchEverywhere: openPaletteOn("all"),
      goToFile: openPaletteOn("files"),
      goToSymbol: openPaletteOn("symbols"),
      recentFiles: openPaletteOn("files"),
      findInFiles: openFindInFiles(false),
      replaceInFiles: openFindInFiles(true),
    },
  };
}
