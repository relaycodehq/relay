import { ErrorBox } from "../../ui/ui";
import { PaneResizer } from "../../ui/PaneResizer";
import type { ChecksController } from "../checks/useProjectChecks";
import { FileSide } from "./FileSide";
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
};

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
  ...thread
}: FilesSidebarProps) {
  const { open } = workspace;
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
      onOpenFile={(path) => open({ path })}
      onPickFolder={browsing.setFolder}
      onRenamed={workspace.renamed}
      onTrashed={workspace.trashed}
    />
  );
  return (
    <aside className="project-file-list" hidden={browsing.listHidden}>
      <PaneResizer pane="files" label="Resize file list" initial={210} min={160} max={600} />
      <SidebarViews
        views={[{ id: "files", label: "Files", content: files }, ...changes.views]}
        shown={browsing.sideView}
        onShow={browsing.showSideView}
      />
      {!!changes.error && <ErrorBox error={changes.error} />}
    </aside>
  );
}
