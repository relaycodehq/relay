import { useCallback, useEffect, useState } from "react";
import {
  ChevronsLeftRight,
  ChevronsRightLeft,
  GitPullRequest,
  X,
} from "lucide-react";
import type { LinkedFolder, Project } from "../../shared/projects";
import type { QuestionTarget } from "../../shared/questions";
import type { SourceControlKind } from "../../shared/source-control";
import type { Account, Pull, PullRef } from "../../shared/types";
import { useNavigationLock } from "../lib/navigation-lock";
import type { PaneOpens } from "./usePaneOpens";
import type { ThreadFolder } from "./useThreadFolder";
import {
  NO_VIEWING,
  type ThreadView,
  type Viewing,
} from "../features/thread/useThreadView";
import { PullReviewPane } from "../features/review/PullReviewPane";
import { HostPrompt } from "../features/pulls/host-prompt";
import { ProjectHistory } from "../features/changes/ProjectHistory";
import { ProjectFiles } from "../features/files/ProjectFiles";
import { useUnsavedIn } from "../features/editor/documents";
import { EditorElsewhere } from "../features/editor-windows/EditorElsewhere";
import {
  popOutEditor,
  useEditorElsewhere,
} from "../features/editor-windows/editor-windows";
import { FolderGoneEmpty } from "../features/projects/FolderGone";
import { WORKTREE_DELETED } from "./thread-folder";
import { NO_SLOTS, PaneHeader, type PaneSlots } from "../ui/WorkspacePanes";
import { PaneTabs } from "../ui/PaneTabs";
import { IconButton } from "../ui/ui";
import type { PanelTabs } from "../features/panel/panel-tabs";
import {
  SURFACE_ICONS,
  SURFACE_LABELS,
  SurfacePicker,
} from "../features/panel/SurfacePicker";
import {
  closeTerminal,
  terminalFor,
} from "../features/terminal/thread-terminals";
import { terminalLabel } from "../features/terminal/TerminalDrawer";
import { TerminalView } from "../features/terminal/TerminalView";
import { BrowserTabIcon } from "../features/browser/BrowserSurface";
import { PanelBrowsers } from "../features/browser/PanelBrowsers";
import { useNewTabKey } from "../features/panel/useNewTabKey";
import { DeviceSurface } from "../features/device/DeviceSurface";
import { closeDeviceView } from "../features/device/device-hub";
import {
  closePreview,
  previewKey,
  usePreviewStates,
} from "../features/browser/previews";
import { readText, writeText } from "../lib/persisted-store";

/** A PR thread's Review, which needs the Git host connected. */
export function ThreadChanges({
  project,
  pull,
  folder: { where },
  view,
  opens,
  review,
}: {
  project: Project;
  pull: PullRef;
  folder: ThreadFolder;
  view: ThreadView;
  opens: PaneOpens;
  review: {
    /** Who Relay reviews as on the project's host; null until signed in. */
    account: Account | null;
    kind: SourceControlKind | null;
    error: string | null;
    checking: boolean;
    onRecheck: () => void;
    /** Asks the PR's thread about lines of its diff. */
    onDiscuss: (target: QuestionTarget, pr: Pull) => void;
    /** Absent while Gitea is off in Settings → Integrations. */
    onConnect?: () => void;
  };
}) {
  const [slots, setSlots] = useState<PaneSlots>(NO_SLOTS);
  const editorElsewhere = useEditorElsewhere(where);
  // Editing takes over from the diff, so Review steps aside for Files; not
  // for an editor in its own window, which leaves this one as it was.
  const editFile = (path: string, line?: number) => {
    const opened = opens.openInEditor({ path, line, directory: false });
    if (opened && !editorElsewhere) opens.togglePane("changes");
  };
  const reviewFile = `relay-project-review-file:${project.id}:${pull.number}`;
  return (
    <>
      <PaneHeader
        icon={<GitPullRequest size={14} />}
        title="Review"
        onSlots={setSlots}
        onClose={() => opens.togglePane("changes")}
      />
      {review.account && project.repository ? (
        <div className="project-review">
          <PullReviewPane
            key={`${project.id}:${pull.number}`}
            pull={pull}
            workspace={where}
            account={review.account}
            initialFile={readText(reviewFile)}
            slots={slots}
            onEditFile={editFile}
            reveals={opens.changeReveals}
            onPresence={(next) => {
              view.setViewing(next);
              if (next.path) writeText(reviewFile, next.path);
            }}
            onDiscuss={review.onDiscuss}
          />
        </div>
      ) : (
        <div className="empty pane-empty">
          <GitPullRequest size={28} />
          <HostPrompt
            kind={review.kind}
            error={review.error}
            checking={review.checking}
            onRecheck={review.onRecheck}
            onConnectGitea={review.onConnect}
          />
        </div>
      )}
    </>
  );
}

/** The file the Files tab shows, which its tab is named after. */
function useFilesViewing(
  setViewing: (viewing: Viewing) => void,
  where: string,
) {
  const editorElsewhere = useEditorElsewhere(where);
  const [filesPath, setFilesPath] = useState<string | null>(null);
  const filesViewing = useCallback(
    (v: Viewing) => {
      setFilesPath(v.path);
      setViewing(v);
    },
    [setViewing],
  );
  // Its file is open in the other window now, not in this one.
  useEffect(() => {
    if (editorElsewhere) filesViewing(NO_VIEWING);
  }, [editorElsewhere, filesViewing]);
  return { filesPath, filesViewing };
}

/** The panel's Files: the editor, or a note that it is in a window of its own. */
function PanelFiles({
  project,
  chatId,
  folder: { where, watched, detail, checks, gone, deleted },
  active,
  opens,
  onViewing,
  onError,
  agentRunning,
  inWorktree,
  onOpenThread,
  links,
}: {
  project: Project;
  chatId: string | null;
  folder: ThreadFolder;
  active: boolean;
  opens: PaneOpens;
  onViewing: (viewing: Viewing) => void;
  onError: (error: unknown) => void;
  agentRunning?: boolean;
  inWorktree?: boolean;
  onOpenThread?: (chatId: string) => void;
  links?: readonly LinkedFolder[];
}) {
  const unsavedHere = useUnsavedIn(where);
  const editorElsewhere = useEditorElsewhere(where);
  // An unsaved edit stays on screen, to copy out before it goes.
  if ((gone || deleted) && !unsavedHere)
    return <FolderGoneEmpty reason={deleted ? WORKTREE_DELETED : undefined} />;
  if (editorElsewhere)
    return (
      <EditorElsewhere
        project={project}
        where={where}
        detail={detail?.text}
        onError={onError}
      />
    );
  return (
    <ProjectFiles
      key={where}
      active={active}
      project={project}
      where={where}
      watched={watched}
      checks={checks}
      onViewing={onViewing}
      opens={opens.fileOpens}
      onAsk={(code) => opens.ask({ text: "", code })}
      chatId={chatId ?? undefined}
      agentRunning={agentRunning}
      inWorktree={inWorktree}
      onOpenThread={onOpenThread}
      onPopOut={() => void popOutEditor(project.id, where).catch(onError)}
      links={links}
    />
  );
}

/** The panel's tab strip: each surface's icon and name, a file's own name for Files. */
function usePanelTabItems(
  panel: PanelTabs,
  pageKey: (page?: string) => string,
  filesPath: string | null,
  locked: boolean,
) {
  const previews = usePreviewStates();
  let terminals = 0;
  return panel.tabs.map((tab) => {
    const preview =
      tab.surface === "browser" ? previews(pageKey(tab.page)) : undefined;
    return {
      key: tab.key,
      icon:
        tab.surface === "browser" ? (
          <BrowserTabIcon
            key={preview?.favicon ?? "globe"}
            favicon={preview?.favicon}
          />
        ) : (
          SURFACE_ICONS[tab.surface]
        ),
      closeLabel:
        tab.surface === "browser"
          ? "Close browser"
          : tab.surface === "files"
            ? "Close files"
            : undefined,
      label:
        tab.surface === "terminal"
          ? terminalLabel(terminals++)
          : tab.surface === "browser"
            ? preview?.title.trim() ||
              preview?.worktree ||
              SURFACE_LABELS.browser
            : tab.surface === "files" && filesPath
              ? filesPath.split("/").pop() || SURFACE_LABELS.files
              : SURFACE_LABELS[tab.surface],
      closeDisabled: tab.surface === "files" && locked,
      unseen: tab.key === panel.unseen,
    };
  });
}

/** Closes a panel tab and ends what it held: a shell, the preview, the device view. */
function closePanelTab(
  key: string,
  {
    panel,
    projectId,
    chatId,
    opens,
  }: {
    panel: PanelTabs;
    projectId: string;
    chatId: string | null;
    opens: PaneOpens;
  },
) {
  const tab = panel.tabs.find((t) => t.key === key);
  if (tab?.slot) closeTerminal(projectId, chatId, tab.slot);
  if (tab?.surface === "browser")
    closePreview(previewKey(projectId, chatId, tab.page));
  if (tab?.surface === "device") closeDeviceView();
  panel.close(key);
  // The last tab gone leaves only the picker, so the panel goes with it.
  if (panel.tabs.length === 1 && tab) opens.togglePane("panel");
}

/**
 * The third pane: the surfaces the thread opened as tabs, or the picker.
 * Files and History stay mounted behind other tabs, so an unsaved edit and
 * where the history was scrolled survive a look at a terminal.
 */
export function ThreadPanel({
  project,
  chatId,
  folder,
  view,
  opens,
  panel,
  zoomed,
  onZoom,
  onError,
  agentRunning,
  inWorktree,
  onOpenThread,
  links,
}: {
  project: Project;
  chatId: string | null;
  folder: ThreadFolder;
  view: ThreadView;
  opens: PaneOpens;
  panel: PanelTabs;
  /** The panel fills the workspace, the other panes and the sidebar stepped aside. */
  zoomed: boolean;
  onZoom: (zoomed: boolean) => void;
  onError: (error: unknown) => void;
  agentRunning?: boolean;
  /** The thread works in a worktree Relay made, which Files compares with its source branch. */
  inWorktree?: boolean;
  onOpenThread?: (chatId: string) => void;
  /** The folders linked to the thread with `/add-dir`, which Files shows beside the project's. */
  links?: readonly LinkedFolder[];
}) {
  const { locked } = useNavigationLock();
  const { where, detail, gone, deleted } = folder;
  const [historySlots, setHistorySlots] = useState<PaneSlots>(NO_SLOTS);
  const historyTitle = useCallback(
      (title: HTMLElement | null) => setHistorySlots((s) => ({ ...s, title })),
      [],
    ),
    historyActions = useCallback(
      (actions: HTMLElement | null) =>
        setHistorySlots((s) => ({ ...s, actions })),
      [],
    );
  const { filesPath, filesViewing } = useFilesViewing(view.setViewing, where);
  const front = panel.front;
  const pageKey = (page?: string) => previewKey(project.id, chatId, page);
  const tabs = usePanelTabItems(panel, pageKey, filesPath, locked);
  useNewTabKey(panel, pageKey);
  const close = (key: string) =>
    closePanelTab(key, { panel, projectId: project.id, chatId, opens });
  const folderShown =
    front?.surface === "files" || front?.surface === "history";
  return (
    <>
      <header className="pane-header panel-header">
        <PaneTabs
          tabs={tabs}
          front={front?.key ?? null}
          onFront={panel.bring}
          onClose={close}
          add={
            panel.tabs.length
              ? {
                  label: "Open another surface",
                  active: !front,
                  onClick: panel.pick,
                }
              : undefined
          }
        />
        <div
          className="pane-title-slot"
          ref={historyTitle}
          hidden={front?.surface !== "history"}
        />
        {folderShown && detail && (
          <small className="pane-header-detail" title={detail.title}>
            {detail.text}
          </small>
        )}
        <div
          className="pane-header-actions"
          ref={historyActions}
          hidden={front?.surface !== "history"}
        />
        <IconButton
          label={zoomed ? "Restore the other panes" : "Expand panel"}
          active={zoomed}
          onClick={() => onZoom(!zoomed)}
        >
          {zoomed ? (
            <ChevronsRightLeft size={15} />
          ) : (
            <ChevronsLeftRight size={15} />
          )}
        </IconButton>
        <IconButton
          label="Close panel"
          disabled={locked && panel.has("files")}
          onClick={() => opens.togglePane("panel")}
        >
          <X size={15} />
        </IconButton>
      </header>
      {!front && (
        <SurfacePicker
          plain={project.plain}
          elsewhere={!!project.computer}
          onPick={panel.add}
        />
      )}
      {panel.has("files") && (
        <div className="panel-body" hidden={front?.surface !== "files"}>
          <PanelFiles
            project={project}
            chatId={chatId}
            folder={folder}
            active={front?.surface === "files"}
            opens={opens}
            onViewing={filesViewing}
            onError={onError}
            agentRunning={agentRunning}
            inWorktree={inWorktree}
            onOpenThread={onOpenThread}
            links={links}
          />
        </div>
      )}
      {panel.has("history") && !project.plain && (
        <div className="panel-body" hidden={front?.surface !== "history"}>
          {gone || deleted ? (
            <FolderGoneEmpty reason={deleted ? WORKTREE_DELETED : undefined} />
          ) : (
            <ProjectHistory
              key={where}
              projectId={where}
              slots={historySlots}
              onOpenFile={(path, commit) =>
                void opens.openCommitFile(commit, path)
              }
            />
          )}
        </div>
      )}
      <PanelBrowsers
        panel={panel}
        projectId={project.id}
        chatId={chatId}
        draftKey={opens.draftKey}
      />
      {panel.has("device") && (
        <div className="panel-body" hidden={front?.surface !== "device"}>
          <DeviceSurface front={front?.surface === "device"} />
        </div>
      )}
      {front?.slot !== undefined && (
        <TerminalView
          key={front.key}
          terminal={terminalFor(project.id, chatId, front.slot)}
          onNewShell={() =>
            terminalFor(project.id, chatId, panel.addTerminal())
          }
        />
      )}
    </>
  );
}
