import { useRef, useSyncExternalStore } from "react";
import type { Project } from "../../../shared/projects";
import { documents } from "../editor/documents";
import {
  allTabs,
  focusedGroup,
  focusGroup,
  moveToGroup,
  pinIn,
  renameInGroups,
  split,
  type EditorLayout,
} from "./editor-groups";
import { tabId, tabIsWithin, type EditorTab } from "./editor-tabs";
import { emptyHistory, type History } from "./navigation-history";
import { hasUnsavedEdits, tabDocument } from "./tab-documents";
import { useClosedTabs } from "./useClosedTabs";
import { useEditorLayout } from "./useEditorLayout";
import { useTabClosing } from "./useTabClosing";
import { useTabOpening } from "./useTabOpening";

/**
 * The workspace's editor: its splits and their tabs, which file a tab's
 * document is, Back and Forward through the places jumps left from, and
 * closing a tab (asking first over unsaved edits), pinning, and bringing
 * back closed ones. Files open in the split
 * last used.
 */
export function useEditorWorkspace({
  where,
  project,
  expand,
}: {
  where: string;
  project: Project;
  /** Opens the tree down to a file. */
  expand: (paths: string[]) => void;
}) {
  const [layout, setLayout] = useEditorLayout(where);
  const history = useRef<History>(emptyHistory);
  const closedTabs = useClosedTabs(where);
  const home = { where, plain: project.plain };
  // Tabs show which files hold unsaved edits.
  useSyncExternalStore(
    (listener) => documents.subscribe(listener),
    () => documents.version,
  );
  const focused = focusedGroup(layout);
  const frontTab =
    focused.tabs.find((t) => tabId(t) === focused.active) ?? null;
  const opening = useTabOpening({
    layout,
    setLayout,
    home,
    frontTab,
    history,
    closedTabs,
    expand,
  });
  const { closing, closed, requestClose, closeMany, trashed } = useTabClosing(
    { layout, setLayout, home, history, closedTabs },
  );
  /** A file or folder moved: tabs and documents on it or under it follow. */
  const renamed = (from: string, to: string) => {
    for (const tab of allTabs(layout))
      if (tabIsWithin(tab, from))
        documents.rename(
          tabDocument(tab, home).source,
          tab.path,
          to + tab.path.slice(from.length),
        );
    setLayout((l) => renameInGroups(l, from, to));
  };

  return {
    layout,
    frontTab,
    closing,
    unsaved: (tab: EditorTab) => hasUnsavedEdits(tab, home),
    ...opening,
    focus: (group: string) => setLayout((l) => focusGroup(l, group)),
    /** Splits `group`, showing its front tab or the tab `shown`. */
    split: (
      group: string,
      direction?: EditorLayout["direction"],
      shown?: string,
    ) => setLayout((l) => split(l, group, direction, shown)),
    pin: (group: string, id: string, pinned: boolean) =>
      setLayout((l) => pinIn(l, group, id, pinned)),
    move: (from: string, id: string, to: string, before: string | null) =>
      setLayout((l) => moveToGroup(l, from, id, to, before)),
    requestClose,
    closeMany,
    closed,
    renamed,
    trashed,
  };
}

export type EditorWorkspace = ReturnType<typeof useEditorWorkspace>;
