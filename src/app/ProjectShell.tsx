import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import type { RelayCommand } from "../../shared/commands";
import type { ChatSummary, Project } from "../../shared/projects";
import { threadWorktree } from "../../shared/projects";
import { api } from "../lib/api";
import { fitHeader } from "./header-fit";
import {
  NavigationLockProvider,
  useNavigationLockRoot,
} from "../lib/navigation-lock";
import { projectFor } from "../features/pulls/pull-board";
import { SIDEBAR_WIDTH } from "../lib/settings-page";
import { useShortcut } from "../lib/shortcuts";
import { adoptDraftTerminal } from "../features/terminal/thread-terminals";
import { usePanelTabs } from "../features/panel/panel-tabs";
import { useIncomingLinks } from "./useIncomingLinks";
import { useOpenedFolders } from "./useOpenedFolders";
import { useNewThreads } from "./useNewThreads";
import { usePaneOpens } from "./usePaneOpens";
import { useProjects } from "./useProjects";
import { usePullsPage } from "../features/pulls/usePullsPage";
import { useHostAccount } from "../features/pulls/useHostAccount";
import { usePullsAccount } from "../features/pulls/usePullsAccount";
import { NoPullHost } from "../features/pulls/NoPullHost";
import { ConnectHost } from "../features/pulls/ConnectHost";
import { usePullThreads } from "./usePullThreads";
import { useSettingsPage } from "../features/settings/useSettingsPage";
import { sameSpot, useShellSpot, type ShellSpot } from "./shell-spot";
import { useShellNavigation } from "./useShellNavigation";
import { useSidebarVisibility } from "./useSidebarVisibility";
import { useSignIn } from "../features/settings/useSignIn";
import { useThreadFolder } from "./useThreadFolder";
import { useThreadTerminal } from "./useThreadTerminal";
import { NO_VIEWING, useThreadView } from "../features/thread/useThreadView";
import { paneFrame, type PaneId } from "../lib/workspace-panes";
import { PullsSurface } from "./PullsSurface";
import {
  GitActions,
  type GitActionsHandle,
} from "../features/changes/GitActions";
import { HandoffButton } from "../features/handoff/HandoffButton";
import { AddProjectPalette } from "../features/add-project/AddProjectPalette";
import { NewThreadPicker } from "../features/projects/NewThreadPicker";
import { NoProject } from "../features/projects/NoProject";
import { PaneResizer } from "../ui/PaneResizer";
import { ProjectChat } from "../features/thread/ProjectChat";
import { StartedThreadsContext } from "../features/agent-turn/StartedThreads";
import { useEveryThread } from "../features/sidebar/useSidebarThreads";
import { ProjectChecksButton } from "../features/checks/ProjectChecks";
import type { ComposerControls } from "../features/composer/ProjectComposer";
import { ProjectSidebar } from "../features/sidebar/ProjectSidebar";
import { PullsTitle } from "../features/pulls/PullRequestsPage";
import { UsagePage, UsageTitle } from "../features/usage/UsagePage";
import { RunningTasks } from "../features/terminal/RunningTasks";
import { Settings } from "../features/settings/Settings";
import {
  ProjectTitle,
  TerminalToggle,
  ThreadPaneToggles,
  TitlebarBrand,
} from "./ShellTitlebar";
import { SignInDialog } from "../features/settings/SignInDialog";
import { TerminalDrawer } from "../features/terminal/TerminalDrawer";
import { ThreadChanges, ThreadPanel } from "./ThreadPanes";
import { ErrorBox, IconButton, Loading } from "../ui/ui";
import { Pane } from "../ui/WorkspacePanes";
import { useUndoShortcut } from "./useUndoShortcut";
import "./shell.css";
const NO_PROJECTS: Project[] = [];

export default function ProjectShell() {
  const qc = useQueryClient();
  const boot = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api.bootstrap(),
    staleTime: Infinity,
    refetchInterval: (q) =>
      q.state.data?.loginRestore === "unlocking" ? 500 : false,
    refetchIntervalInBackground: true,
  });
  const signIn = useSignIn(boot.data);
  const projects = useProjects(boot.data);
  const gitActions = useRef<GitActionsHandle>(null);
  const composer = useRef<ComposerControls>(null);
  const [choosePR, setChoosePR] = useState(false);
  const [error, setError] = useState<unknown>();
  useUndoShortcut(setError);
  const lock = useNavigationLockRoot((message) => setError(new Error(message)));
  const view = useThreadView();
  const nav = useShellNavigation(projects.data, lock, view);
  const { project, chats, chat, draftId, pull, panes, inbox, navigate } = nav;
  const usage = nav.surface === "usage";
  // Pull requests or Usage instead of a project.
  const elsewhere = nav.surface !== "project";
  // A page stands in for the chat alone.
  const sidebar = useSidebarVisibility(
    !elsewhere && panes.visible.some((id) => id !== "chat"),
  );
  const settings = useSettingsPage(nav.selected, nav.chatId, nav.surface);
  // The sidebar's unread / needs-input dot, echoed on the brand while hidden.
  const [attention, setAttention] = useState<"waiting" | "unread">();
  // Scratchpad chats have their own sidebar section and never show as projects.
  const realProjects = projects.data?.filter((p) => !p.scratch) ?? [];
  const everyThread = useEveryThread(realProjects);
  const terminal = useThreadTerminal(nav);
  const folder = useThreadFolder(nav);
  const panel = usePanelTabs(panes.layout.thread);
  const opens = usePaneOpens(nav, panel, view, folder, lock, setError);
  const links = useIncomingLinks(boot.data, nav, signIn, lock, setError);
  const prs = usePullThreads(nav, lock, setError);
  const pullsPage = usePullsPage(
    lock,
    projects.refetch,
    prs.openInProject,
    setError,
  );
  const spotNow = useShellSpot(nav);
  /** Opens a thread that took a while to make, unless the user went elsewhere meanwhile. */
  async function openCreated(c: ChatSummary, from: ShellSpot) {
    await qc.refetchQueries({ queryKey: ["project-chats", from.projectId] });
    if (sameSpot(spotNow(), from)) nav.setChatId(c.id);
  }
  const starts = useNewThreads(
    nav,
    projects,
    lock,
    () => composer.current?.focus(),
    setError,
  );
  useOpenedFolders(boot.data, projects, lock, starts.open);
  useShortcut("settings", true, () => settings.show());
  useShortcut("new-thread", !!project && !elsewhere && !error, starts.pick);
  useShortcut("new-scratch", true, () => void starts.scratch());
  function runCommand(command: RelayCommand) {
    if (lock.blocked()) return false;
    if (command === "openpr") gitActions.current?.openPr();
    else if ((command === "new" || command === "clear") && project?.scratch)
      void starts.scratch();
    else if ((command === "new" || command === "clear") && project)
      navigate(project, undefined, true);
    else if (command === "files" || command === "changes")
      opens.openCode(command);
    else return false;
    return true;
  }
  async function linkProject() {
    if (!project) return;
    const id = project.id;
    await signIn.withAccount(async () => {
      try {
        await api.linkProject(id);
        await projects.refetch();
      } catch (e) {
        setError(e);
      }
    });
  }
  const frame = (id: PaneId) => ({
    ...paneFrame(panes.layout, id),
    onResize: panes.resize,
    onMove: panes.move,
  });
  const host = useHostAccount(project?.repository, boot.data?.account);
  const pullsHost = usePullsAccount(boot.data?.account);
  if (boot.error) return <ErrorBox error={boot.error} />;
  if (!boot.data) return <Loading text="Opening your workspace…" />;
  const account = boot.data.account;
  // Off in Settings → Integrations, nothing offers to connect it.
  const gitea = boot.data.gitea;
  const codeOpen =
    panes.layout.open.changes ||
    (panes.layout.open.panel && panel.has("files"));
  const page = (
    <div className={`app project-app platform-${boot.data.platform}`}>
      <header
        className={`titlebar project-titlebar ${sidebar.hidden && !settings.open ? "sidebar-collapsed" : ""}`}
      >
        <TitlebarBrand
          sidebar={sidebar}
          attention={attention}
          disabled={settings.open}
        />
        <div className="project-titlebar-main" ref={fitHeader}>
          {settings.open ? (
            <div className="project-window-title">
              <span>Settings</span>
              <span className="breadcrumb-slash">/</span>
              <strong>{settings.where}</strong>
            </div>
          ) : inbox ? (
            <PullsTitle where={pullsPage.where} onNav={pullsPage.go} />
          ) : usage ? (
            <UsageTitle />
          ) : (
            <ProjectTitle project={project} chat={chat} onError={setError} />
          )}
          <span className="spacer" />
          {!settings.open && !elsewhere && project && (
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
                  onConnect={() => setChoosePR(true)}
                  onReview={(ref) => void prs.review(ref)}
                  onChanges={() => opens.openCode("changes")}
                  onError={setError}
                />
              )}
              <div className="header-strip">
                {chat && !project.plain && !project.scratch && (
                  <>
                    <HandoffButton
                      chat={chat}
                      onError={setError}
                      onSettings={() => settings.show("computers")}
                    />
                    <span className="header-strip-sep" aria-hidden="true" />
                  </>
                )}
                <ThreadPaneToggles
                  panes={panes}
                  plain={project.plain}
                  pull={pull}
                  lines={folder.tree?.lines}
                  filesOpen={panel.has("files")}
                  onToggle={opens.togglePane}
                />
                <span className="header-strip-sep" aria-hidden="true" />
                <TerminalToggle terminal={terminal} />
              </div>
            </div>
          )}
          {sidebar.hidden && !settings.open && (
            <IconButton label="Open settings" onClick={() => settings.show()}>
              <Settings2 size={16} />
            </IconButton>
          )}
        </div>
      </header>
      <div className="project-layout" ref={sidebar.layoutRef}>
        <aside
          ref={sidebar.asideRef}
          className={`projects-sidebar ${sidebar.hidden ? "overlay" : ""} ${sidebar.peek ? "peek" : ""}`}
          aria-label="Projects"
          aria-hidden={sidebar.hidden && !sidebar.peek ? true : undefined}
          inert={sidebar.hidden && !sidebar.peek ? true : undefined}
          hidden={settings.open}
          onMouseEnter={sidebar.hidden ? sidebar.peekOpen : undefined}
          onMouseLeave={sidebar.hidden ? sidebar.peekClose : undefined}
        >
          <PaneResizer pane="sidebar" {...SIDEBAR_WIDTH} />
          <ProjectSidebar
            initialView={boot.data.sidebarView}
            projects={projects.data ?? []}
            showing={
              elsewhere
                ? { inbox, usage }
                : {
                    projectId: project?.id,
                    chatId: chat?.id,
                    draftId: chat ? undefined : draftId,
                  }
            }
            onOpen={navigate}
            onPickNew={starts.pick}
            onNewScratch={() => void starts.scratch()}
            onSendDraft={() => composer.current?.submit()}
            onAdd={() => starts.addProject()}
            onAttention={setAttention}
            onSettings={settings.show}
            onInbox={() => {
              // From the page itself it goes back to the board; from anywhere
              // else it returns to where the page was left.
              if (lock.blocked()) return;
              if (inbox) pullsPage.go({ to: "board" });
              else nav.setInbox(true);
            }}
            onUsage={() => {
              if (!lock.blocked()) nav.setSurface("usage");
            }}
          />
          {projects.error && <ErrorBox error={projects.error} />}
        </aside>
        {inbox ? (
          <div className="project-legacy" hidden={settings.open}>
            {pullsHost.account ? (
              <PullsSurface
                key={pullsHost.account.id}
                ref={pullsPage.page}
                account={pullsHost.account}
                initialWorkspace={boot.data.workspace}
                incomingLink={links.incoming}
                projects={projects.data ?? NO_PROJECTS}
                projectOf={(repo) =>
                  projectFor(
                    projects.data ?? NO_PROJECTS,
                    pullsHost.account!.server,
                    repo,
                  )
                }
                onOpenInProject={(p, ref) => void prs.openInProject(p, ref)}
                onOpenProject={(p) => navigate(p)}
                onAddProject={(repo) => void pullsPage.addProject(repo)}
                onLocation={pullsPage.setWhere}
              />
            ) : pullsHost.pending ? (
              <Loading />
            ) : (
              <NoPullHost
                checking={pullsHost.checking}
                onRecheck={pullsHost.recheck}
                onConnectGitea={
                  gitea ? () => void signIn.withAccount() : undefined
                }
              />
            )}
          </div>
        ) : usage ? (
          <div className="project-legacy" hidden={settings.open}>
            <UsagePage />
          </div>
        ) : !project ? (
          <NoProject
            hidden={settings.open}
            onAdd={() => starts.addProject()}
            onScratch={() => void starts.scratch()}
          />
        ) : (
          <div className="workspace-column" hidden={settings.open}>
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
                        projects.data?.find((p) => p.id === c.projectId) ??
                          project,
                        c,
                      ),
                  }}
                >
                  <ProjectChat
                    key={chat?.id ?? draftId}
                    ref={composer}
                    project={project}
                    projects={realProjects}
                    chat={chat}
                    draftId={draftId}
                    draftScope={nav.draftScope}
                    viewing={codeOpen ? view.viewing : NO_VIEWING}
                    contextText={view.context}
                    onContextUsed={() => view.setContext(undefined)}
                    scopes={{
                      canChoosePR: !!host.account || host.pending,
                      onRepository: () => nav.newThreadIn({ kind: "project" }),
                      onChoosePR:
                        project.repository || account
                          ? () => {
                              if (!lock.blocked()) setChoosePR(true);
                            }
                          : undefined,
                      onSelectPR: (ref) => nav.newThreadIn({ kind: "pr", ref }),
                      onDeepReview: () => nav.newThreadIn({ kind: "review" }),
                    }}
                    opens={{
                      onOpenCode: opens.openCode,
                      onOpenFile: opens.openChatFile,
                      onOpenTurnDiff: opens.openTurnDiff,
                    }}
                    onCommand={runCommand}
                    onDraftWorkspace={nav.setDraftWorkspace}
                    onStartThread={starts.start}
                    onCreated={async (c) => {
                      const from: ShellSpot = {
                        projectId: project.id,
                        chatId: null,
                        draftId,
                        surface: "project",
                      };
                      if (!c.worktree && sameSpot(spotNow(), from))
                        adoptDraftTerminal(project.id, c.id);
                      await openCreated(c, from);
                    }}
                    onForked={(c) =>
                      openCreated(c, {
                        projectId: project.id,
                        chatId: chat?.id ?? null,
                        draftId,
                        surface: "project",
                      })
                    }
                    onOpenThread={(c) =>
                      openCreated(c, {
                        projectId: project.id,
                        chatId: chat?.id ?? null,
                        draftId,
                        surface: "project",
                      })
                    }
                    onSwitchProject={(next) => navigate(next, undefined, true)}
                    onAddProject={() => starts.addProject()}
                    onProjectSettings={() =>
                      settings.show("project", project.id)
                    }
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
                      onConnect: gitea ? () => void linkProject() : undefined,
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
        )}
        {settings.open && (
          <Settings
            account={account ?? null}
            initialCategory={settings.category}
            key={settings.project ?? "app"}
            projectId={settings.project}
            initialQuery={settings.query}
            onQueryChange={settings.setQuery}
            onWhere={settings.setWhere}
            onClose={settings.close}
            onConnect={() => {
              settings.close();
              void signIn.withAccount();
            }}
            onOpenChat={(projectId, chatId) => {
              const p = projects.data?.find((p) => p.id === projectId);
              if (!p) return;
              void qc
                .fetchQuery({
                  queryKey: ["project-chats", projectId],
                  queryFn: () => api.projectChats(projectId),
                })
                .then((list) => {
                  const next = list.find((c) => c.id === chatId);
                  if (!next) return;
                  navigate(p, next);
                  settings.close();
                })
                .catch(setError);
            }}
            onDisconnect={async () => {
              await signIn.signOut();
              settings.close();
              nav.setInbox(false);
            }}
          />
        )}
      </div>
      {!!error && (
        <div className="toast error">
          <ErrorBox error={error} />
          <button onClick={() => setError(undefined)}>Dismiss</button>
        </div>
      )}
      {choosePR && project && !host.account && !host.pending && (
        <ConnectHost
          github={host.github}
          checking={host.checking}
          onRecheck={host.recheck}
          onConnectGitea={gitea ? () => void linkProject() : undefined}
          onClose={() => setChoosePR(false)}
        />
      )}
      {starts.picking && (
        <NewThreadPicker
          projects={realProjects}
          current={project?.id ?? null}
          onSelect={(p) => {
            starts.setPicking(false);
            starts.open(p);
          }}
          onAdd={() => starts.addProject()}
          onClose={() => starts.setPicking(false)}
        />
      )}
      {starts.adding && (
        <AddProjectPalette
          projects={realProjects}
          onClose={() => starts.setAdding(false)}
          onDone={(p) => void starts.added(p)}
        />
      )}
      {signIn.open && (
        <SignInDialog
          boot={boot.data}
          signIn={signIn}
          onRestored={boot.refetch}
        />
      )}
    </div>
  );
  return <NavigationLockProvider value={lock}>{page}</NavigationLockProvider>;
}
