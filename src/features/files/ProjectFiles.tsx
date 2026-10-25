import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CodeReference } from "../../../shared/code-references";
import type { Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import type { FilesRequest } from "./file-link-target";
import type { RequestChannel } from "../../lib/request-channel";
import type { ChecksController } from "../checks/useProjectChecks";
import { useExpanded } from "./useFileTree";
import type { Viewing } from "../thread/useThreadView";
import { useEditorWorkspace } from "./useEditorWorkspace";
import { useDeletedFiles } from "./useDeletedFiles";
import { recentPaths } from "./editor-groups";
import { SearchPalette } from "./EditorSearch";
import { EditorPane } from "./EditorPane";
import { FilesSidebar } from "./FilesSidebar";
import { searchJump } from "./open-targets";
import { useShortcut } from "../../lib/shortcuts";
import { useEditorSearch } from "./useEditorSearch";
import { useFileBrowsing } from "./useFileBrowsing";

type ProjectFilesProps = {
  /** The Files tab is in front; hidden editors stay mounted without polling. */
  active: boolean;
  project: Project;
  /** Workspace id: the checkout, or the thread's worktree. */
  where: string;
  /** The shell refreshes its listings when the folder changes. */
  watched: boolean;
  /** Owned by the shell, which shows the status in the title bar. */
  checks: ChecksController;
  onViewing: (v: Viewing) => void;
  /** Files to open, such as ones clicked in the chat. */
  opens?: RequestChannel<FilesRequest>;
  /** Attaches lines selected in the editor to the thread's composer. */
  onAsk?: (ref: CodeReference) => void;
  /** The thread whose agents' changes in other repositories list under the folder's own. */
  chatId?: string;
  /** The thread's agent is at work in this folder: pulling waits for it. */
  agentRunning?: boolean;
  onOpenThread?: (chatId: string) => void;
  /** The thread works in a worktree Relay made, which the sidebar compares with its source branch. */
  inWorktree?: boolean;
};

/**
 * The folder the thread works in: a tree read straight from disk (ignored
 * files included), folder and picture views, and an inline editor for text.
 */
export function ProjectFiles({
  active,
  project,
  where,
  watched,
  checks,
  onViewing,
  opens,
  ...thread
}: ProjectFilesProps) {
  // Refreshed by the shell's working-tree poll.
  const tree = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
    enabled: !project.plain,
  });
  const expansion = useExpanded(where);
  const pane = useRef<HTMLDivElement>(null);
  const source = { kind: "project", where, plain: project.plain } as const;
  const deleted = useDeletedFiles(where, source, tree.data);
  const workspace = useEditorWorkspace({
    where,
    project,
    expand: expansion.expand,
  });
  const browsing = useFileBrowsing({ opens, expansion, open: workspace.open });
  const search = useEditorSearch({ active, pane });
  useShortcut("reopen-tab", active, workspace.reopenClosed);

  const { frontTab } = workspace;
  const shownPath = frontTab && !frontTab.outside ? frontTab.path : null;
  useEffect(() => {
    onViewing({ path: shownPath, viewed: 0, total: 0 });
  }, [shownPath, onViewing]);

  return (
    <div className="files-workspace" ref={pane}>
      <SearchPalette
        where={where}
        request={search.palette}
        recent={recentPaths(workspace.layout)}
        activePath={shownPath ?? undefined}
        onOpen={(target) => workspace.open(...searchJump(target))}
        onClose={search.closePalette}
      />
      <FilesSidebar
        active={active}
        where={where}
        title={project.name}
        plain={!!project.plain}
        watched={watched}
        changeCount={tree.data?.changes.length}
        checks={checks}
        workspace={workspace}
        browsing={browsing}
        expansion={expansion}
        shownPath={shownPath}
        {...thread}
      />
      <EditorPane
        workspace={workspace}
        where={where}
        source={source}
        active={active}
        checks={checks}
        deleted={deleted}
        tree={tree.data}
        browsing={browsing}
        search={search}
        onAsk={thread.onAsk}
      />
    </div>
  );
}
