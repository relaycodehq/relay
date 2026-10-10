import { useEffect, useRef, useState } from "react";
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
import { onOpenSettings, SIDEBAR_WIDTH } from "../lib/settings-page";
import { useStableCallback } from "../lib/useStableCallback";
import { useShortcut } from "../lib/shortcuts";
import { adoptDraftTerminal } from "../features/terminal/thread-terminals";
import { useIncomingLinks } from "./useIncomingLinks";
import { useOpenedFolders } from "./useOpenedFolders";
import { useNewThreads } from "./useNewThreads";
import { useProjects } from "./useProjects";
import { usePullsPage } from "../features/pulls/usePullsPage";
import { usePullsAccount } from "../features/pulls/usePullsAccount";
import { NoPullHost } from "../features/pulls/NoPullHost";
import { ConnectHost } from "../features/pulls/ConnectHost";
import { useSettingsPage } from "../features/settings/useSettingsPage";
import { sameSpot, useShellSpot, type ShellSpot } from "./shell-spot";
import { useShellNavigation } from "./useShellNavigation";
import { useSidebarVisibility } from "./useSidebarVisibility";
import { useSignIn } from "../features/settings/useSignIn";
import { useThreadView } from "../features/thread/useThreadView";
import { PullsSurface } from "./PullsSurface";
import type { GitActionsHandle } from "../features/changes/GitActions";
import { AddProjectPalette } from "../features/add-project/AddProjectPalette";
import { NewThreadPicker } from "../features/projects/NewThreadPicker";
import { NoProject } from "../features/projects/NoProject";
import { PaneResizer } from "../ui/PaneResizer";
import { useEveryThread } from "../features/sidebar/useSidebarThreads";
import type { ComposerControls } from "../features/composer/ProjectComposer";
import { ProjectSidebar } from "../features/sidebar/ProjectSidebar";
import { PullsTitle } from "../features/pulls/PullRequestsPage";
import { UsagePage, UsageTitle } from "../features/usage/UsagePage";
import { Settings } from "../features/settings/Settings";
import { ProjectTitle, TitlebarBrand } from "./ShellTitlebar";
import {
  ThreadHeaderActions,
  ThreadWorkspace,
  useThreadTools,
} from "./ThreadWorkspace";
import { PopOutButton } from "../features/thread-windows/ThreadWindowButtons";
import { ThreadElsewhere } from "../features/thread-windows/ThreadElsewhere";
import {
  hasOwnWindow,
  useHasOwnWindow,
} from "../features/thread-windows/thread-windows";
import type { ThreadWindow } from "../../shared/thread-windows";
import { SignInDialog } from "../features/settings/SignInDialog";
import { ErrorBox, IconButton, Loading } from "../ui/ui";
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
  const { project, chat, draftId, panes, inbox, navigate } = nav;
  const usage = nav.surface === "usage";
  // Pull requests or Usage instead of a project.
  const elsewhere = nav.surface !== "project";
  // A page stands in for the chat alone.
  const sidebar = useSidebarVisibility(
    !elsewhere && panes.visible.some((id) => id !== "chat"),
    {
      on: !elsewhere && !!panes.layout.zoomed,
      exit: () => panes.zoom(undefined),
    },
  );
  const settings = useSettingsPage(nav.selected, nav.chatId, nav.surface);
  const showSettings = useStableCallback(settings.show);
  useEffect(() => onOpenSettings(showSettings), [showSettings]);
  // The sidebar's unread / needs-input dot, echoed on the brand while hidden.
  const [attention, setAttention] = useState<"waiting" | "unread">();
  // Scratchpad chats have their own sidebar section and never show as projects.
  const realProjects = projects.data?.filter((p) => !p.scratch) ?? [];
  const everyThread = useEveryThread(realProjects);
  const tools = useThreadTools(nav, view, lock, boot.data?.account, setError);
  const { opens, prs, host } = tools;
  const links = useIncomingLinks(boot.data, nav, signIn, lock, setError);
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
  /**
   * Opens `c`, or brings its own window up when it has one. Pass `here`
   * to show it in this window regardless, as one coming back does.
   */
  function open(p: Project, c?: ChatSummary, fresh?: true | string) {
    if (c && !fresh && hasOwnWindow(c.id))
      void api.openThreadWindow(p.id, c.id).catch(setError);
    else navigate(p, c, fresh);
  }
  /** A thread known only by its ids, as Settings and Usage name one. */
  function openChatById(
    projectId: string,
    chatId: string,
    then?: () => void,
    here = false,
  ) {
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
        if (here) navigate(p, next);
        else open(p, next);
        then?.();
      })
      .catch(setError);
  }
  const loaded = !!projects.data;
  // A thread back from its own window shows here, even before its window
  // has finished closing; the one that opened this window waits for it to load.
  useEffect(() => {
    if (!loaded) return;
    const show = (t: ThreadWindow | null) =>
      t && openChatById(t.projectId, t.chatId, undefined, true);
    void api.takeOpenThread().then(show).catch(setError);
    return api.onOpenThread(show);
  }, [loaded]);
  const poppedOut = useHasOwnWindow(chat?.id);
  const pullsHost = usePullsAccount(boot.data?.account);
  if (boot.error) return <ErrorBox error={boot.error} />;
  if (!boot.data) return <Loading text="Opening your workspace…" />;
  const account = boot.data.account;
  // Off in Settings → Integrations, nothing offers to connect it.
  const gitea = boot.data.gitea;
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
          {!settings.open && !elsewhere && project && !poppedOut && (
            <ThreadHeaderActions
              tools={tools}
              project={project}
              gitActions={gitActions}
              move={chat && <PopOutButton chat={chat} onError={setError} />}
              onConnectHost={() => setChoosePR(true)}
              onSettings={settings.show}
            />
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
            onOpen={open}
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
            <UsagePage onOpenChat={openChatById} />
          </div>
        ) : !project ? (
          <NoProject
            hidden={settings.open}
            onAdd={() => starts.addProject()}
            onScratch={() => void starts.scratch()}
          />
        ) : chat && poppedOut ? (
          <ThreadElsewhere
            key={chat.id}
            chat={chat}
            projectName={project.name}
            hidden={settings.open}
            onError={setError}
          />
        ) : (
          <ThreadWorkspace
            tools={tools}
            project={project}
            projects={realProjects}
            allProjects={projects.data ?? NO_PROJECTS}
            everyThread={everyThread}
            composer={composer}
            hidden={settings.open}
            onChoosePR={
              project.repository || account
                ? () => {
                    if (!lock.blocked()) setChoosePR(true);
                  }
                : undefined
            }
            onCommand={runCommand}
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
            onOpened={(c) =>
              openCreated(c, {
                projectId: project.id,
                chatId: chat?.id ?? null,
                draftId,
                surface: "project",
              })
            }
            onAddProject={() => starts.addProject()}
            onSettings={settings.show}
            onLinkProject={gitea ? () => void linkProject() : undefined}
          />
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
            onOpenChat={(projectId, chatId) =>
              openChatById(projectId, chatId, settings.close)
            }
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
