import type { CodeReference } from "../../../shared/code-references";
import type { WorkingTree } from "../../../shared/working-tree";
import type { ChecksController } from "../checks/useProjectChecks";
import type { DocumentSource } from "../editor/documents";
import type { OpenTarget } from "../editor/FileEditor";
import type { FileTarget } from "./file-link-target";
import { EditorGroups } from "./EditorGroups";
import { FindDock } from "./EditorSearch";
import { FileListToggle, PopOutButton } from "./EditorTabButtons";
import { NoFileOpen } from "./NoFileOpen";
import { editorJump, searchJump } from "./open-targets";
import type { useDeletedFiles } from "./useDeletedFiles";
import type { EditorWorkspace } from "./useEditorWorkspace";
import type { useEditorSearch } from "./useEditorSearch";
import type { FileBrowsing } from "./useFileBrowsing";

/** What each editor in the splits needs from the pane around it. */
function editorFor({
  workspace,
  where,
  source,
  tree,
  checks,
  browsing,
  search,
  onAsk,
}: {
  workspace: EditorWorkspace;
  where: string;
  source: Extract<DocumentSource, { kind: "project" }>;
  tree: WorkingTree | undefined;
  checks: ChecksController;
  browsing: FileBrowsing;
  search: ReturnType<typeof useEditorSearch>;
  onAsk?: (ref: CodeReference) => void;
}) {
  return {
    source,
    target: { projectId: where, head: { sha: tree?.head ?? "" } },
    checks,
    stamp: tree?.revision,
    onOpenLink: (target: FileTarget) =>
      target.directory
        ? browsing.showFolder(target.path)
        : workspace.open({ path: target.path }),
    onOpenFile: (target: OpenTarget) => workspace.open(...editorJump(target)),
    host: search.host,
    onBack: workspace.back,
    onForward: workspace.forward,
    onAsk,
  };
}

/** The editor's splits with Find in Files docked under them. */
export function EditorPane({
  workspace,
  where,
  source,
  active,
  checks,
  deleted,
  tree,
  browsing,
  search,
  onAsk,
  onPopOut,
}: {
  workspace: EditorWorkspace;
  where: string;
  source: Extract<DocumentSource, { kind: "project" }>;
  active: boolean;
  checks: ChecksController;
  deleted: ReturnType<typeof useDeletedFiles>;
  /** The folder's working tree; the editor waits for its HEAD, except in a plain folder. */
  tree: WorkingTree | undefined;
  browsing: FileBrowsing;
  search: ReturnType<typeof useEditorSearch>;
  onAsk?: (ref: CodeReference) => void;
  onPopOut?: () => void;
}) {
  const { open } = workspace;
  const editor =
    tree || source.plain
      ? editorFor({
          workspace,
          where,
          source,
          tree,
          checks,
          browsing,
          search,
          onAsk,
        })
      : undefined;
  return (
    <div className="files-main">
      <EditorGroups
        workspace={workspace}
        where={where}
        active={active}
        checks={checks}
        lead={
          <FileListToggle
            hidden={browsing.listHidden}
            onToggle={browsing.toggleList}
          />
        }
        trail={onPopOut && <PopOutButton onClick={onPopOut} />}
        deleted={deleted}
        changeOf={(path) => tree?.changes.find((c) => c.path === path)}
        editor={editor}
        empty={<NoFileOpen onFind={browsing.focusFilter} />}
        onRevealInList={(group, tab) => {
          workspace.activate(group, tab);
          browsing.revealInList(tab.path);
        }}
      />
      {search.finding && (
        <FindDock
          where={where}
          source={source}
          request={search.finding}
          onOpen={(target) => open(...searchJump(target))}
          onClose={search.closeFinding}
        />
      )}
    </div>
  );
}
