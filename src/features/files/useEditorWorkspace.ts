import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import type { Project } from "../../../shared/projects";
import { documents } from "../editor/documents";
import {
  allTabs,
  focusedGroup,
  focusGroup,
  keepEdited,
  keepIn,
  moveToGroup,
  pinIn,
  renameInGroups,
  split,
  type EditorLayout,
} from "./editor-groups";
import { tabId, tabIsWithin, type EditorTab } from "./editor-tabs";
import { emptyHistory, forget, type History } from "./navigation-history";
import {
  hasUnsavedEdits,
  moveTabDocuments,
  type TabHome,
} from "./tab-documents";
import { useClosedTabs, type ClosedTabs } from "./useClosedTabs";
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
  const edits = useSyncExternalStore(
    (listener) => documents.subscribe(listener),
    () => documents.version,
  );
  const editedPreview = (tab: EditorTab) =>
    !!tab.preview && hasUnsavedEdits(tab, home);
  useEffect(() => {
    if (allTabs(layout).some(editedPreview))
      setLayout((l) => keepEdited(l, (tab) => hasUnsavedEdits(tab, home)));
  }, [edits, layout]);
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
  const { closing, closed, requestClose, closeMany, trashed } = useTabClosing({
    layout,
    setLayout,
    home,
    history,
    closedTabs,
  });
  /** A file or folder moved, in the project or with `outside` outside it: tabs follow. */
  const renamed = followMove({ layout, setLayout, home, history, closedTabs });

  return {
    layout,
    frontTab,
    closing,
    unsaved: (tab: EditorTab) => hasUnsavedEdits(tab, home),
    ...opening,
    focus: (group: string) => setLayout((l) => focusGroup(l, group)),
    /** A previewed tab stays open when another file is looked at. */
    keep: (group: string, id: string) => setLayout((l) => keepIn(l, group, id)),
    /** Splits `group`, showing its front tab or the tab `shown`. */
    split: (
      group: string,
      direction?: EditorLayout["direction"],
      shown?: string,
    ) => setLayout((l) => split(l, group, direction, shown)),
    pin: (group: string, id: string, pinned: boolean) =>
      setLayout((l) => pinIn(l, group, id, pinned)),
    move: (from: string, id: string, to: string, before: string | null) =>
      setLayout((l) =>
        moveToGroup(l, from, id, to, before, (t) => hasUnsavedEdits(t, home)),
      ),
    requestClose,
    closeMany,
    closed,
    renamed,
    trashed,
  };
}

export type EditorWorkspace = ReturnType<typeof useEditorWorkspace>;

/**
 * What to do when a file or folder moved, in the project or with `outside`
 * outside it: its tabs and documents follow, and places at the old path are
 * forgotten.
 */
function followMove(ws: {
  layout: EditorLayout;
  setLayout: ReturnType<typeof useEditorLayout>[1];
  home: TabHome;
  history: RefObject<History>;
  closedTabs: ClosedTabs;
}) {
  return (from: string, to: string, outside = false) => {
    moveTabDocuments(allTabs(ws.layout), ws.home, from, to, outside);
    ws.setLayout((l) => renameInGroups(l, from, to, outside));
    const gone = (tab: EditorTab) => tabIsWithin(tab, from, outside);
    ws.history.current = forget(ws.history.current, gone);
    ws.closedTabs.forget(gone);
  };
}
