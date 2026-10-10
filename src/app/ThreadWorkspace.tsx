import type { ComponentProps, ReactNode, Ref } from "react";
import type { RelayCommand } from "../../shared/commands";
import type { ChatSummary, Project } from "../../shared/projects";
import { threadWorktree } from "../../shared/projects";
import type { Account } from "../../shared/types";
import type { SettingsCategory } from "../lib/settings-page";
import type { NavigationLock } from "../lib/navigation-lock";
import { paneFrame, type PaneId } from "../lib/workspace-panes";
import { usePanelTabs } from "../features/panel/panel-tabs";
import { useHostAccount } from "../features/pulls/useHostAccount";
import { NO_VIEWING, type ThreadView } from "../features/thread/useThreadView";
import {
  GitActions,
  type GitActionsHandle,
} from "../features/changes/GitActions";
import { HandoffButton } from "../features/handoff/HandoffButton";
import { ProjectChat } from "../features/thread/ProjectChat";
import { StartedThreadsContext } from "../features/agent-turn/StartedThreads";
import { ProjectChecksButton } from "../features/checks/ProjectChecks";
import type { ComposerControls } from "../features/composer/ProjectComposer";
import { RunningTasks } from "../features/terminal/RunningTasks";
import { TerminalDrawer } from "../features/terminal/TerminalDrawer";
import { Pane } from "../ui/WorkspacePanes";
import { TerminalToggle, ThreadPaneToggles } from "./ShellTitlebar";
import { ThreadChanges, ThreadPanel } from "./ThreadPanes";
import { usePaneOpens } from "./usePaneOpens";
import { usePullThreads } from "./usePullThreads";
import type { ShellNavigation } from "./useShellNavigation";
import { useThreadFolder } from "./useThreadFolder";
import { useThreadTerminal } from "./useThreadTerminal";

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
  onSettings,
}: {
  tools: ThreadTools;
  project: Project;
  gitActions: Ref<GitActionsHandle>;
  move?: ReactNode;
  onConnectHost: () => void;
  onSettings: (at: SettingsCategory, projectId?: string) => void;
}) {
  const { chat, panes, pull } = nav;
  const handoff = chat && !project.plain && !project.scratch ? chat : undefined;
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
      {!project.plain && (
        <GitActions
          key={folder.where}
          project={project}
          where={folder.where}
          connected={!!host.account}
          disabled={lock.locked}
          ref={gitActions}
          onConnect={onConnectHost}
          onReview={(ref) => void prs.review(ref)}
          onChanges={() => opens.openCode("changes")}
          onError={setError}
        />
      )}
      <div className="header-strip">
        {(move || handoff) && (
          <>
            {move}
            {handoff && (
              <HandoffButton
                chat={handoff}
                onError={setError}
                onSettings={() => onSettings("computers")}
              />
            )}
            <span className="header-strip-sep" aria-hidden="true" />
          </>
        )}
        <ThreadPaneToggles
          panes={panes}
          plain={project.plain}
          pull={pull}
          lines={folder.tree?.lines}
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

/**
 * The thread's panes, chat, Changes and the panel, over its terminal. What
 * would leave the thread goes through `nav`, which a thread's own window
 * hands to the main one.
 */
export function ThreadWorkspace({
  tools: { nav, view, folder, panel, opens, prs, host, terminal, setError },
  project,
  projects,
  allProjects,
  everyThread,
  composer,
  hidden,
  onChoosePR,
  onCommand,
  onStartThread,
  onCreated,
  onOpened,
  onAddProject,
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
  hidden?: boolean;
  onChoosePR?: () => void;
  onCommand: (command: RelayCommand) => boolean;
  onStartThread: ChatProps["onStartThread"];
  onCreated: ChatProps["onCreated"];
  /** A thread made from this one, forked or started, to open. */
  onOpened: ChatProps["onOpenThread"];
  onAddProject: () => void;
  onSettings: (at: SettingsCategory, projectId?: string) => void;
  onLinkProject?: () => void;
}) {
  const { chat, chats, draftId, panes, pull, navigate } = nav;
  const codeOpen =
    panes.layout.open.changes ||
    (panes.layout.open.panel && panel.has("files"));
  const frame = (id: PaneId) => ({
    ...paneFrame(panes.layout, id),
    onResize: panes.resize,
    onMove: panes.move,
  });
  return (
    <div className="workspace-column" hidden={hidden}>
      <div className="workspace-panes">
        <Pane
          id="chat"
          label="Chat"
          {...frame("chat")}
          className="project-chat-pane"
        >
          <StartedThreadsContext.Provider
            value={{
              lead: chat?.id,
              // A lead and the threads it started may be in different projects.
              threads: everyThread,
              open: (c) =>
                navigate(
                  allProjects.find((p) => p.id === c.projectId) ?? project,
                  c,
                ),
            }}
          >
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
              }}
              onCommand={onCommand}
              onDraftWorkspace={nav.setDraftWorkspace}
              onStartThread={onStartThread}
              onCreated={onCreated}
              onForked={onOpened}
              onOpenThread={onOpened}
              onSwitchProject={(next) => navigate(next, undefined, true)}
              onAddProject={onAddProject}
              onProjectSettings={() => onSettings("project", project.id)}
            />
          </StartedThreadsContext.Provider>
          <RunningTasks
            key={project.id}
            project={project}
            chats={chats.data ?? []}
            onOpenChat={(c) => navigate(project, c)}
          />
        </Pane>
        <Pane id="changes" label="Changes" {...frame("changes")}>
          {panes.layout.open.changes && (
            <ThreadChanges
              project={project}
              pull={pull}
              folder={folder}
              view={view}
              opens={opens}
              review={{
                account: host.account,
                github: host.github,
                onRecheck: host.recheck,
                onDiscuss: (target, pr) =>
                  void prs
                    .open(pr)
                    .then(() => opens.askAbout(target, pr))
                    .catch(setError),
                onConnect: onLinkProject,
              }}
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
