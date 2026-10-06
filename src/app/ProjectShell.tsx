import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import type { RelayCommand } from "../../shared/commands";
import type { ChatSummary, Project } from "../../shared/projects";
import { api } from "../lib/api";
import { fitHeader } from "./header-fit";
import {
  NavigationLockProvider,
  useNavigationLockRoot,
} from "../lib/navigation-lock";
import { projectFor } from "../features/pulls/pull-board";
import { SIDEBAR_WIDTH } from "../lib/settings-page";
import { useShortcut } from "../lib/shortcuts";
import { openThread } from "../lib/thread-storage";
import {
  adoptDraftTerminal,
  terminalFor,
} from "../features/terminal/thread-terminals";
import { useIncomingLinks } from "./useIncomingLinks";
import { useNewThreads } from "./useNewThreads";
import { usePaneOpens } from "./usePaneOpens";
import { useProjects } from "./useProjects";
import { usePullsPage } from "../features/pulls/usePullsPage";
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
import { NewThreadPicker } from "../features/projects/NewThreadPicker";
import { NoProject } from "../features/projects/NoProject";
import { PaneResizer } from "../ui/PaneResizer";
import { ProjectChat } from "../features/thread/ProjectChat";
import { StartedThreadsContext } from "../features/agent-turn/StartedThreads";
import { ProjectChecksButton } from "../features/checks/ProjectChecks";
import type { ComposerControls } from "../features/composer/ProjectComposer";
import {
  BrowseShared,
  JoinConversation,
  ShareConversation,
} from "../features/projects/ProjectSharingDialogs";
import { ProjectSidebar } from "../features/sidebar/ProjectSidebar";
import { PullsTitle } from "../features/pulls/PullRequestsPage";
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
import { ThreadChanges, ThreadFiles, ThreadHistory } from "./ThreadPanes";
import { ErrorBox, IconButton, Loading, Modal } from "../ui/ui";
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
  // The Pull requests page stands in for the chat alone.
  const sidebar = useSidebarVisibility(
    !inbox && panes.visible.some((id) => id !== "chat"),
  );
  const settings = useSettingsPage(nav.selected, nav.chatId, inbox);
  // The sidebar's unread / needs-input dot, echoed on the brand while hidden.
  const [attention, setAttention] = useState<"waiting" | "unread">();
  const [share, setShare] = useState<ChatSummary>(),
    [browseShared, setBrowseShared] = useState(false);
  // Scratchpad chats have their own sidebar section and never show as projects.
  const realProjects = projects.data?.filter((p) => !p.scratch) ?? [];
  const terminal = useThreadTerminal(nav);
  const folder = useThreadFolder(nav);
  const opens = usePaneOpens(nav, view, folder, lock, setError);
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
  useShortcut("settings", true, () => settings.setOpen(true));
  useShortcut("new-thread", !!project && !inbox && !error, starts.pick);
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
  if (boot.error) return <ErrorBox error={boot.error} />;
  if (!boot.data) return <Loading text="Opening your workspace…" />;
  const account = boot.data.account;
  const codeOpen = panes.layout.open.changes || panes.layout.open.files;
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
          ) : (
            <ProjectTitle project={project} chat={chat} onError={setError} />
          )}
          <span className="spacer" />
          {!settings.open && !inbox && project && (
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
                  connected={!!account}
                  disabled={lock.locked}
                  ref={gitActions}
                  onConnect={() => void signIn.withAccount()}
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
                  onToggle={opens.togglePane}
                />
                <span className="header-strip-sep" aria-hidden="true" />
                <TerminalToggle terminal={terminal} />
              </div>
            </div>
          )}
          {sidebar.hidden && !settings.open && (
            <IconButton
              label="Open settings"
              onClick={() => settings.setOpen(true)}
            >
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
              inbox
                ? { inbox: true }
                : {
                    projectId: project?.id,
                    chatId: chat?.id,
                    draftId: chat ? undefined : draftId,
                  }
            }
            account={account?.user.login}
            onOpen={navigate}
            onPickNew={starts.pick}
            onNewScratch={() => void starts.scratch()}
            onSendDraft={() => composer.current?.submit()}
            onAdd={() => void starts.addProject()}
            onShared={(p) => {
              if (navigate(p)) setBrowseShared(true);
            }}
            onAttention={setAttention}
            onSettings={settings.show}
            onAccount={() => {
              if (!account) return void signIn.withAccount();
              settings.show("account");
            }}
            onInbox={() => {
              // From the page itself it goes back to the board; from anywhere
              // else it returns to where the page was left.
              if (lock.blocked()) return;
              if (!account) void signIn.withAccount(() => nav.setInbox(true));
              else if (inbox) pullsPage.go({ to: "board" });
              else nav.setInbox(true);
            }}
          />
          {projects.error && <ErrorBox error={projects.error} />}
        </aside>
        {inbox && account ? (
          <div className="project-legacy" hidden={settings.open}>
            <PullsSurface
              ref={pullsPage.page}
              account={account}
              initialWorkspace={boot.data.workspace}
              incomingLink={links.incoming}
              projects={projects.data ?? NO_PROJECTS}
              projectOf={(repo) =>
                projectFor(projects.data ?? NO_PROJECTS, account.server, repo)
              }
              onOpenInProject={(p, ref) => void prs.openInProject(p, ref)}
              onOpenProject={(p) => navigate(p)}
              onAddProject={(repo) => void pullsPage.addProject(repo)}
              onLocation={pullsPage.setWhere}
              onSettings={(category) =>
                settings.show(category === "rooms" ? category : undefined)
              }
            />
          </div>
        ) : !project ? (
          <NoProject
            hidden={settings.open}
            onAdd={() => void starts.addProject()}
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
                    threads: chats.data ?? [],
                    open: (c) => navigate(project, c),
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
                      canChoosePR: !!account && !!project.repository,
                      onRepository: () => nav.newThreadIn({ kind: "project" }),
                      onChoosePR: () => {
                        if (!lock.blocked()) setChoosePR(true);
                      },
                      onSelectPR: (ref) => nav.newThreadIn({ kind: "pr", ref }),
                      onDeepReview: () => nav.newThreadIn({ kind: "review" }),
                    }}
                    opens={{
                      onOpenCode: opens.openCode,
                      onOpenFile: opens.openChatFile,
                      onOpenTurnDiff: opens.openTurnDiff,
                    }}
                    onCommand={runCommand}
                    onShare={() => {
                      if (chat) void signIn.withAccount(() => setShare(chat));
                    }}
                    onDraftWorkspace={nav.setDraftWorkspace}
                    onStartThread={starts.start}
                    onCreated={async (c) => {
                      const from: ShellSpot = {
                        projectId: project.id,
                        chatId: null,
                        draftId,
                        inbox: false,
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
                        inbox: false,
                      })
                    }
                    onOpenThread={(c) =>
                      openCreated(c, {
                        projectId: project.id,
                        chatId: chat?.id ?? null,
                        draftId,
                        inbox: false,
                      })
                    }
                    onSwitchProject={(next) => navigate(next, undefined, true)}
                    onAddProject={() => void starts.addProject()}
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
                      account,
                      onDiscuss: (target, pr) =>
                        void prs
                          .open(pr)
                          .then(() => opens.askAbout(target, pr))
                          .catch(setError),
                      onConnect: () => void linkProject(),
                    }}
                  />
                )}
              </Pane>
              <Pane id="files" label="Files" {...frame("files")}>
                {panes.layout.open.files && (
                  <ThreadFiles
                    project={project}
                    folder={folder}
                    view={view}
                    opens={opens}
                  />
                )}
              </Pane>
              <Pane id="history" label="History" {...frame("history")}>
                {panes.layout.open.history && (
                  <ThreadHistory folder={folder} opens={opens} />
                )}
              </Pane>
            </div>
            {terminal.shown && (
              <TerminalDrawer
                terminal={terminalFor(project.id, chat?.id ?? null)}
                worktree={!!chat?.worktree}
                onClose={() => terminal.close()}
              />
            )}
          </div>
        )}
        {settings.open && (
          <Settings
            account={account ?? null}
            initialCategory={settings.category}
            initialProject={settings.project ?? project?.id}
            onWhere={settings.setWhere}
            onClose={settings.close}
            onConnect={() => {
              settings.setOpen(false);
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
                  settings.setOpen(false);
                })
                .catch(setError);
            }}
            onDisconnect={async () => {
              await signIn.signOut();
              settings.setOpen(false);
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
      {choosePR && project && (
        <Modal title="Connect Gitea" onClose={() => setChoosePR(false)}>
          <p>
            Connect Gitea to match this folder’s Git remote and choose a PR.
          </p>
          <button onClick={() => void linkProject()}>Connect Gitea</button>
        </Modal>
      )}
      {starts.picking && (
        <NewThreadPicker
          projects={realProjects}
          current={project?.id ?? null}
          onSelect={(p) => {
            starts.setPicking(false);
            starts.open(p);
          }}
          onAdd={() => void starts.addProject()}
          onClose={() => starts.setPicking(false)}
        />
      )}
      {signIn.open && (
        <SignInDialog
          boot={boot.data}
          signIn={signIn}
          invitationUrl={links.incoming?.url}
          onRestored={boot.refetch}
        />
      )}
      {links.invitation && (
        <JoinConversation
          url={links.invitation}
          projects={projects.data ?? []}
          account={account ?? null}
          onAdd={starts.addProject}
          onSignIn={() => void signIn.withAccount()}
          onClose={() => links.setInvitation(undefined)}
          onJoined={async (p, c) => {
            if (c) openThread.save(p, c.id);
            nav.setSelected(p);
            await chats.refetch();
            if (c) nav.openChat(c.id);
            nav.setInbox(false);
            panes.show("chat");
            links.setInvitation(undefined);
          }}
        />
      )}
      {browseShared && project && (
        <BrowseShared
          project={project}
          onClose={() => setBrowseShared(false)}
          onOpen={async (c) => {
            await chats.refetch();
            nav.openChat(c.id);
            panes.show("chat");
            setBrowseShared(false);
          }}
        />
      )}
      {share && project && (
        <ShareConversation
          chat={share}
          project={project}
          account={account ?? null}
          onClose={() => setShare(undefined)}
          onSignIn={() => void signIn.withAccount()}
          onShared={() => void chats.refetch()}
        />
      )}
    </div>
  );
  return <NavigationLockProvider value={lock}>{page}</NavigationLockProvider>;
}
