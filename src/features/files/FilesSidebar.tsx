import { useState } from "react";
import { ErrorBox } from "../../ui/ui";
import { PaneResizer } from "../../ui/PaneResizer";
import type { ChecksController } from "../checks/useProjectChecks";
import { FileSide, type LinkedFiles } from "./FileSide";
import { SidebarViews } from "./SidebarViews";
import { useChangeViews, type ThreadChangesProps } from "./useChangeViews";
import type { EditorWorkspace } from "./useEditorWorkspace";
import type { FileBrowsing } from "./useFileBrowsing";
import type { useExpanded } from "./useFileTree";

type FilesSidebarProps = ThreadChangesProps & {
  /** The Files tab is in front. */
  active: boolean;
  where: string;
  /** The project's name, over the tree. */
  title: string;
  plain: boolean;
  watched: boolean;
  /** The thread works in a worktree Relay made, which can be compared with its source branch. */
  inWorktree?: boolean;
  /** Files with changes, shown beside the Changes view's name. */
  changeCount?: number;
  checks: ChecksController;
  workspace: EditorWorkspace;
  browsing: FileBrowsing;
  expansion: ReturnType<typeof useExpanded>;
  /** The file in front. */
  shownPath: string | null;
  linked: LinkedFiles;
};

const MIN_WIDTH = 160;
const MAX_WIDTH = 600;

/**
 * The editor's sidebar, resizable and hideable: the folder's files, its
 * changes in a Git project, and in a worktree what it has that its branch
 * doesn't. A change picked opens in the editor with its changes in place.
 */
export function FilesSidebar({
  active,
  where,
  title,
  plain,
  watched,
  inWorktree,
  changeCount,
  checks,
  workspace,
  browsing,
  expansion,
  shownPath,
  linked,
  ...thread
}: FilesSidebarProps) {
  const { open } = workspace;
  const [namesWidth, setNamesWidth] = useState(0);
  const changes = useChangeViews({
    where,
    plain,
    inWorktree,
    changeCount,
    shownPath,
    open,
    browsing,
    thread,
  });
  const files = (
    <FileSide
      active={active && !browsing.listHidden}
      where={where}
      watched={watched}
      title={title}
      filter={browsing.filter}
      onFilter={browsing.setFilter}
      findInput={browsing.filterInput}
      shownPath={shownPath}
      folder={browsing.folder}
      expansion={expansion}
      checks={checks}
      onOpenFile={(path, preview) =>
        open(preview ? { path, preview: true } : { path })
      }
      onPickFolder={browsing.setFolder}
      onRenamed={workspace.renamed}
      onTrashed={workspace.trashed}
      linked={linked}
    />
  );
  // Never narrower than the view names over it, border included, nor wider than the list may be.
  const minWidth = Math.min(Math.max(MIN_WIDTH, namesWidth + 1), MAX_WIDTH);
  return (
    <aside
      className="project-file-list"
      hidden={browsing.listHidden}
      style={{ minWidth: `min(${minWidth}px, 60%)` }}
    >
      <PaneResizer
        pane="files"
        label="Resize file list"
        initial={210}
        min={minWidth}
        max={MAX_WIDTH}
      />
      <SidebarViews
        views={[{ id: "files", label: "Files", content: files }, ...changes.views]}
        shown={browsing.sideView}
        onShow={browsing.showSideView}
        onNamesWidth={setNamesWidth}
      />
      {!!changes.error && <ErrorBox error={changes.error} />}
    </aside>
  );
}
