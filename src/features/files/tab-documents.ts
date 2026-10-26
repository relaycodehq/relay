import { documents, type DocumentSource } from "../editor/documents";
import { tabIsWithin, type EditorTab } from "./editor-tabs";
import type { Place } from "./navigation-history";
import { outsideSource } from "./OutsideFile";

/** The folder tabs of project files are read from: the checkout or a worktree. */
export type TabHome = { where: string; plain?: boolean };

/** Where the document store keeps the file a tab shows; a snapshot tab has none. */
export function tabDocument(
  tab: EditorTab,
  home: TabHome,
): { source: DocumentSource; path: string } {
  if (!tab.outside)
    return {
      source: { kind: "project", where: home.where, plain: home.plain },
      path: tab.path,
    };
  const { source, name } = outsideSource(tab.path);
  return { source, path: name };
}

/** Lets a tab's document go; `discard` lets unsaved edits go too. */
export function closeTabDocument(
  tab: EditorTab,
  home: TabHome,
  discard = false,
) {
  // A snapshot's file may be open in another tab; its document isn't this tab's.
  if (tab.snapshot) return;
  const { source, path } = tabDocument(tab, home);
  documents.close(source, path, discard);
}

/**
 * Tabs on a moved file or folder, or under it, keep their documents, with
 * their unsaved edits, at the new path; a file outside the project whose
 * folder moved goes with it to the new folder.
 */
export function moveTabDocuments(
  tabs: EditorTab[],
  home: TabHome,
  from: string,
  to: string,
  outside: boolean,
) {
  for (const tab of tabs) {
    if (!tabIsWithin(tab, from, outside)) continue;
    const moved = { ...tab, path: to + tab.path.slice(from.length) };
    const before = tabDocument(tab, home);
    const after = tabDocument(moved, home);
    documents.rename(before.source, before.path, after.path, after.source);
  }
}

export function hasUnsavedEdits(tab: EditorTab, home: TabHome) {
  if (tab.snapshot) return false; // read-only
  const { source, path } = tabDocument(tab, home);
  return !!documents.find(source, path)?.status.dirty;
}

/** Where the caret is in a tab, 1-based; the top when its document isn't loaded. */
export function caretPlace(tab: EditorTab, home: TabHome): Place {
  if (tab.snapshot) return { tab, line: 1, column: 1 };
  const { source, path } = tabDocument(tab, home);
  const state = documents.find(source, path)?.state;
  if (!state) return { tab, line: 1, column: 1 };
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { tab, line: line.number, column: head - line.from + 1 };
}
