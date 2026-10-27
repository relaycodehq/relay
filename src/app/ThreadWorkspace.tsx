import type { ComponentProps, ReactNode, Ref, RefObject } from "react";
import type { RelayCommand } from "../../shared/commands";
import type { ChatSummary, Project } from "../../shared/projects";
import { threadWorktree } from "../../shared/projects";
import type { Account, PullRef } from "../../shared/types";
import type { SettingsCategory } from "../lib/settings-page";
import { LOCKED_MESSAGE, type NavigationLock } from "../lib/navigation-lock";
import { paneFrame, usePaneRow, type PaneId } from "../lib/workspace-panes";
import { useStableCallback } from "../lib/useStableCallback";
import { usePanelTabs } from "../features/panel/panel-tabs";
import { useHostAccount } from "../features/pulls/useHostAccount";
import { NO_VIEWING, type ThreadView } from "../features/thread/useThreadView";
import {
  GitActions,
  type GitActionsHandle,
} from "../features/changes/GitActions";
import { ProjectChat } from "../features/thread/ProjectChat";
import { StartedThreadsContext } from "../features/agent-turn/StartedThreads";
import { ThreadPreviewContext } from "../features/browser/TurnPreview";
import { ProjectChecksButton } from "../features/checks/ProjectChecks";
import { FolderGone } from "../features/projects/FolderGone";
import type { ComposerControls } from "../features/composer/ProjectComposer";
import { TerminalDrawer } from "../features/terminal/TerminalDrawer";
import { useEditorWindowShortcut } from "../features/editor-windows/EditorWindowButtons";
import { Pane } from "../ui/WorkspacePanes";
import { TerminalToggle, ThreadPaneToggles } from "./ShellTitlebar";
import { ThreadChanges, ThreadPanel } from "./ThreadPanes";
import { usePaneOpens } from "./usePaneOpens";
import { usePullThreads } from "./usePullThreads";
import type { ShellNavigation } from "./useShellNavigation";
import { useThreadFolder, type ThreadFolder } from "./useThreadFolder";
import { folderComputer } from "./thread-folder";
import { useThreadTerminal } from "./useThreadTerminal";
import { useThreadPreviewPanel } from "./useThreadPreviewPanel";
import { RunningCard } from "./RunningCard";

type ChatProps = ComponentProps<typeof ProjectChat>;

/**
 * What a thread's header and panes work with: its folder, panel, terminal,
 * the pane openers, its PR and the repository host. The main window and a
 * thread's own window each hold one.
 */
export function useThreadTools(
  nav: ShellNavigation,
  view: ThreadView,
  lock: NavigationLock,
  account: Account | null | undefined,
  setError: (error: unknown) => void,
) {
  const terminal = useThreadTerminal(nav);
  const folder = useThreadFolder(nav);
  const panel = usePanelTabs(
    nav.panes.layout.thread,
    nav.panes.layout.open.panel,
  );
  const opens = usePaneOpens(nav, panel, view, folder, lock, setError);
  const prs = usePullThreads(nav, lock, setError);
  const host = useHostAccount(nav.project?.repository, account);
  return {
    nav,
    view,
    lock,
    terminal,
    folder,
    panel,
    opens,
    prs,
    host,
    setError,
  };
}

export type ThreadTools = ReturnType<typeof useThreadTools>;

/**
 * The thread's checks, Git actions and pane toggles at the header's end.
 * `move` leads the strip: popping the thread out, or putting it back.
 */
export function ThreadHeaderActions({
  tools: { nav, lock, folder, panel, opens, prs, host, terminal, setError },
  project,
  gitActions,
  move,
  onConnectHost,
}: {
  tools: ThreadTools;
  project: Project;
  gitActions: Ref<GitActionsHandle>;
  move?: ReactNode;
  onConnectHost: () => void;
}) {
  const { panes, pull } = nav;
  return (
    <div className="thread-header-actions">
      <ProjectChecksButton
        quiet
        compact
        checks={folder.checks}
        onOpenFile={(path, line) =>
          opens.openInEditor({ path, line, directory: false })
        }
      />
      {!project.plain && !folder.gone && !folder.deleted && (
        <GitActions
          key={folder.where}
          project={project}
          where={folder.where}
          connected={!!host.account}
          locked={lock.locked ? LOCKED_MESSAGE : undefined}
          ref={gitActions}
          onConnect={onConnectHost}
          onReview={(ref) => void prs.review(ref)}
          onChanges={() => opens.openCode("changes")}
          onError={setError}
        />
      )}
      <div className="header-strip">
        {move && (
          <>
            {move}
            <span className="header-strip-sep" aria-hidden="true" />
          </>
        )}
        <ThreadPaneToggles
          panes={panes}
          pull={pull}
          filesOpen={panel.has("files")}
          unseen={!panes.layout.open.panel && !!panel.unseen}
          onToggle={opens.togglePane}
        />
        <span className="header-strip-sep" aria-hidden="true" />
        <TerminalToggle terminal={terminal} />
      </div>
    </div>
  );
}

/** A PR thread's Review, wired to the repository host and the thread's PR. */
function PullReview({
  tools: { folder, view, opens, prs, host, setError },
  project,
  pull,
  onConnect,
}: {
  tools: ThreadTools;
  project: Project;
  pull: PullRef;
  onConnect?: () => void;
}) {
  return (
    <ThreadChanges
      project={project}
      pull={pull}
      folder={folder}
      view={view}
      opens={opens}
      review={{
        account: host.account,
        kind: host.kind,
        error: host.error,
        checking: host.checking,
        onRecheck: host.recheck,
        onDiscuss: (target, pr) =>
          void prs
            .open(pr)
            .then(() => opens.askAbout(target, pr))
            .catch(setError),
        onConnect,
      }}
    />
  );
}

/**
 * Whether the thread's folder can have an editor window of its own. That
 * window reads the folder here, which a thread on another computer left behind.
 */
function editorCanPopOut(
  folder: Pick<ThreadFolder, "gone" | "deleted">,
  project: Project,
  chat: ChatSummary | undefined,
) {
  return !folder.gone && !folder.deleted && !folderComputer(project, chat);
}

/** The threads the open one started, for the chat to list and open. */
function startedThreads(
  { chat, navigate }: ShellNavigation,
  project: Project,
  allProjects: Project[],
  everyThread: ChatSummary[],
) {
  return {
    lead: chat?.id,
    // A lead and the threads it started may be in different projects.
    threads: everyThread,
    open: (c: ChatSummary) =>
      navigate(allProjects.find((p) => p.id === c.projectId) ?? project, c),
  };
}

/**
 * The thread's panes, chat, Changes and the panel, over its terminal. What
 * would leave the thread goes through `nav`, which a thread's own window
 * hands to the main one.
 */
export function ThreadWorkspace({
  tools,
  project,
  projects,
  allProjects,
  everyThread,
  composer,
  gitActions,
  hidden,
  onChoosePR,
  onCommand,
  onStartThread,
  onCreated,
  onOpened,
  onAddProject,
  onScratch,
  onSettings,
  onLinkProject,
}: {
  tools: ThreadTools;
  project: Project;
  /** Projects a thread can switch to; Scratchpad's aren't. */
  projects: Project[];
  allProjects: Project[];
  everyThread: ChatSummary[];
  composer: Ref<ComposerControls>;
  gitActions: RefObject<GitActionsHandle | null>;
  hidden?: boolean;
  onChoosePR?: () => void;
  onCommand: (command: RelayCommand) => boolean;
  onStartThread: ChatProps["onStartThread"];
  onCreated: ChatProps["onCreated"];
  /** A thread made from this one, forked or started, to open. */
  onOpened: ChatProps["onOpenThread"];
  onAddProject: () => void;
  onScratch?: () => void;
  onSettings: (at: SettingsCategory, projectId?: string) => void;
  onLinkProject?: () => void;
}) {
  const { nav, view, folder, panel, opens, host, terminal, setError } = tools;
  const { chat, chats, draftId, panes, pull, navigate } = nav;
  const editorWindowUsable = !hidden && editorCanPopOut(folder, project, chat);
  useEditorWindowShortcut(
    project.id,
    folder.where,
    editorWindowUsable,
    setError,
  );
  const review =
    chat?.reviewer && chats.data?.find((c) => c.id === chat.reviewer?.parent);
  const codeOpen =
    panes.shown.includes("changes") ||
    (panes.layout.open.panel && panel.has("files"));
  const row = usePaneRow(panes.measure);
  const openThread = (id: string) => {
    const c = everyThread.find((t) => t.id === id);
    if (c)
      navigate(allProjects.find((p) => p.id === c.projectId) ?? project, c);
  };
  const previewPanel = useThreadPreviewPanel(
    project.id,
    panel,
    panes.visible.includes("panel"),
    useStableCallback(() => opens.openSurface("browser")),
  );
  const frame = (id: PaneId) => ({
    ...paneFrame(panes.layout, id, panes.visible),
    onResize: panes.resize,
    onMove: panes.move,
  });
  return (
    <div className="workspace-column" hidden={hidden}>
      {folder.gone && <FolderGone project={project} path={folder.gone} />}
      <div className="workspace-panes" ref={row}>
        <Pane
          id="chat"
          label="Chat"
          {...frame("chat")}
          className="project-chat-pane"
        >
          <StartedThreadsContext.Provider
            value={startedThreads(nav, project, allProjects, everyThread)}
          >
            <ThreadPreviewContext.Provider value={previewPanel}>
              <ProjectChat
                key={chat?.id ?? draftId}
                ref={composer}
                project={project}
                projects={projects}
                chat={chat}
                draftId={draftId}
                draftScope={nav.draftScope}
                viewing={codeOpen ? view.viewing : NO_VIEWING}
                contextText={view.context}
                onContextUsed={() => view.setContext(undefined)}
                scopes={{
                  canChoosePR: !!host.account || host.pending,
                  onClearScope: () => nav.newThreadIn({ kind: "project" }),
                  onChoosePR,
                  onSelectPR: (ref) => nav.newThreadIn({ kind: "pr", ref }),
                  onDeepReview: () => nav.newThreadIn({ kind: "review" }),
                }}
                opens={{
                  onOpenCode: opens.openCode,
                  onOpenFile: opens.openChatFile,
                  onOpenTurnDiff: opens.openTurnDiff,
                  // Where the header has no Git actions, there's nothing to commit with.
                  onCommitFiles:
                    project.plain || folder.gone || folder.deleted
                      ? undefined
                      : (paths) =>
                          void gitActions.current?.commit(paths, chat?.id),
                  commitPaths: folder.tree?.changes.map((c) => c.path),
                }}
                onCommand={onCommand}
                onDraftWorkspace={nav.setDraftWorkspace}
                onStartThread={onStartThread}
                onBackToReview={
                  review ? () => void navigate(project, review) : undefined
                }
                onCreated={onCreated}
                onForked={onOpened}
                onOpenThread={onOpened}
                onSwitchProject={(next) => navigate(next, undefined, true)}
                onAddProject={onAddProject}
                onScratch={onScratch}
                onProjectSettings={() => onSettings("project", project.id)}
              />
            </ThreadPreviewContext.Provider>
          </StartedThreadsContext.Provider>
          <RunningCard
            tools={tools}
            project={project}
            onSettings={onSettings}
          />
        </Pane>
        <Pane id="changes" label="Changes" {...frame("changes")}>
          {panes.layout.open.changes && pull && (
            <PullReview
              tools={tools}
              project={project}
              pull={pull}
              onConnect={onLinkProject}
            />
          )}
        </Pane>
        <Pane id="panel" label="Panel" {...frame("panel")}>
          {panes.layout.open.panel && (
            <ThreadPanel
              project={project}
              chatId={chat?.id ?? null}
              folder={folder}
              view={view}
              opens={opens}
              panel={panel}
              zoomed={panes.layout.zoomed === "panel"}
              onZoom={(on) => panes.zoom(on ? "panel" : undefined)}
              onError={setError}
              agentRunning={!!chat?.running}
              inWorktree={!!chat?.worktree}
              onOpenThread={openThread}
              links={chat?.links}
            />
          )}
        </Pane>
      </div>
      {terminal.shown && (
        <TerminalDrawer
          projectId={project.id}
          chatId={chat?.id ?? null}
          worktree={!!threadWorktree(chat)}
          onClose={() => terminal.close()}
        />
      )}
    </div>
  );
}
