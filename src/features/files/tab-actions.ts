import type { EditorTab } from "./editor-tabs";
import { copyFullPath, copyRelativePath, showInFileManager } from "./tab-paths";
import type { TabMenuActions } from "./TabMenu";
import type { EditorWorkspace } from "./useEditorWorkspace";

const report = (what: string) => (error: unknown) =>
  console.error(`Couldn't ${what}`, error);

/** What the menu of a tab in split `group` does, through the workspace. */
export function tabMenuActions(
  ws: EditorWorkspace,
  group: string,
  where: string,
  revealInList: (group: string, tab: EditorTab) => void,
): TabMenuActions {
  return {
    onClose: (id) => ws.requestClose(group, id),
    onCloseMany: (scope, from) => ws.closeMany(group, scope, from),
    onPin: (id, pinned) => ws.pin(group, id, pinned),
    onCopyPath: (tab) =>
      void copyFullPath(tab, where).catch(report("copy the path")),
    onCopyRelativePath: (tab) =>
      void copyRelativePath(tab).catch(report("copy the path")),
    onRevealInList: (tab) => revealInList(group, tab),
    onShowInFileManager: (tab) =>
      void showInFileManager(tab, where).catch(report("show the file")),
    onSplitRight: (id) => ws.split(group, "row", id),
  };
}
