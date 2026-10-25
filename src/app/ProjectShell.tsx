import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatSummary, Project } from "../../shared/projects";
import { api } from "../lib/api";
import { fitHeader } from "./header-fit";
import {
  NavigationLockProvider,
  useNavigationLockRoot,
} from "../lib/navigation-lock";
import { useReportRequests } from "../features/bug-report/useReportRequests";
import { onOpenSettings, SIDEBAR_WIDTH } from "../lib/settings-page";
import { useStableCallback } from "../lib/useStableCallback";
import { onAddProjectRequest } from "../lib/add-project-request";
import { useShortcut } from "../lib/shortcuts";
import { adoptDraftTerminal } from "../features/terminal/thread-terminals";
import { useIncomingLinks } from "./useIncomingLinks";
import { useOpenedFolders } from "./useOpenedFolders";
import { useNewThreads } from "./useNewThreads";
import { useProjects } from "./useProjects";
import { usePullsPage } from "../features/pulls/usePullsPage";
import { usePullHosts } from "../features/pulls/usePullHosts";
import { ConnectHost } from "../features/pulls/ConnectHost";
import { useSettingsPage } from "../features/settings/useSettingsPage";
import { sameSpot, useShellSpot, type ShellSpot } from "./shell-spot";
import { useShellNavigation } from "./useShellNavigation";
import { roomFor } from "../lib/workspace-panes";
import {
  useSidebarVisibility,
  useWindowFitsSidebar,
} from "./useSidebarVisibility";
import { useSignIn } from "../features/settings/useSignIn";
import { useThreadView } from "../features/thread/useThreadView";
import { PullRequestsArea } from "./PullsSurface";
import { useShellCommands } from "./useShellCommands";
import { useThreadOpening } from "./useThreadOpening";
import { useToolPages } from "./useToolPages";
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
import {
  SchedulesPage,
  SchedulesTitle,
} from "../features/schedules/SchedulesPage";
import {
  ProcessesPage,
  ProcessesTitle,
} from "../features/processes/ProcessesPage";
import { Settings } from "../features/settings/Settings";
import { ProjectTitle, TitlebarBrand } from "./ShellTitlebar";
import {
  ThreadHeaderActions,
  ThreadWorkspace,
  useThreadTools,
} from "./ThreadWorkspace";
import { PopOutButton } from "../features/thread-windows/ThreadWindowButtons";
import { ThreadElsewhere } from "../features/thread-windows/ThreadElsewhere";
import { useHasOwnWindow } from "../features/thread-windows/thread-windows";
import { SignInDialog } from "../features/settings/SignInDialog";
import { ErrorBox, Loading } from "../ui/ui";
import { useUndoShortcut } from "./useUndoShortcut";
import "./shell.css";
import { bootstrapQuery } from "../lib/workspace-queries";
const NO_PROJECTS: Project[] = [];

export default function ProjectShell() {
  const qc = useQueryClient();
  const boot = useQuery({
    ...bootstrapQuery,
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
  /** A deep review's reviewer is reached from its review, and leads back to it. */
  const reviewOf = (c: ChatSummary | undefined) => {
    const parent = c?.reviewer?.parent;
    const review = parent && nav.chats.data?.find((r) => r.id === parent);
    return review && project
      ? { title: review.title, open: () => void navigate(project, review) }
      : undefined;
  };
  const usage = nav.surface === "usage";
  const processes = nav.surface === "processes";
  const schedules = nav.surface === "schedules";
  const { toggleUsage, toggleProcesses, toggleSchedules, scheduleShown } =
    useToolPages(nav, lock);
  // Pull requests, Usage or Processes instead of a project.
  const elsewhere = nav.surface !== "project";
  const poppedOut = useHasOwnWindow(chat?.id);
  const settings = useSettingsPage(nav.selected, nav.chatId, nav.surface);
  const noPanes = elsewhere || settings.open || !project || (chat && poppedOut);
  // A page stands in for the chat alone.
  const sidebar = useSidebarVisibility(
    !elsewhere && panes.shown.some((id) => id !== "chat"),
    {
      on: !elsewhere && !!panes.layout.zoomed,
      exit: () => panes.zoom(undefined),
    },
    noPanes ? 0 : roomFor(panes.shown),
  );
  // Settings' own nav stands where the sidebar does.
  const sidebarShown = !sidebar.hidden || settings.open;
  useWindowFitsSidebar(sidebarShown, sidebar.toggled);
  const showSettings = useStableCallback(settings.show);
  useEffect(() => onOpenSettings(showSettings), [showSettings]);
  const showReport = useStableCallback(() => settings.show("report"));
  useReportRequests(showReport, nav.restored);
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
  const addProjectOn = useStableCallback((computerId?: string) =>
    starts.addProject("root", computerId),
  );
  useEffect(() => onAddProjectRequest(addProjectOn), [addProjectOn]);
  useShortcut("settings", true, () => settings.show());
  useShortcut("new-thread", !elsewhere && !error, starts.pick);
  useShortcut("new-scratch", true, () => void starts.scratch());
  const { open, openChatById } = useThreadOpening(nav, projects, setError);
  const runCommand = useShellCommands({
    nav,
    lock,
    gitActions,
    starts,
    opens,
    loaded: !!projects.data,
    setError,
  });
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
  const pullsHosts = usePullHosts(boot.data?.account, projects.data, [
    links.azureServer,
    boot.data?.workspace.pull?.server,
  ]);
  if (boot.error) return <ErrorBox error={boot.error} />;
  if (!boot.data) return <Loading text="Opening your workspace…" />;
  const account = boot.data.account;
  // Off in Settings → Integrations, nothing offers to connect it.
  const gitea = boot.data.gitea;
  const workspace = boot.data.workspace;
  /** The titlebar's middle for the page that's open. */
  function surfaceTitle() {
    switch (nav.surface) {
      case "inbox":
        return (
          <PullsTitle
            where={pullsPage.where}
            onNav={pullsPage.go}
            onLeave={() => !lock.blocked() && nav.setInbox(false)}
          />
        );
      case "usage":
        return <UsageTitle onBack={toggleUsage} />;
      case "processes":
        return <ProcessesTitle onBack={toggleProcesses} />;
      case "schedules":
        return <SchedulesTitle onBack={toggleSchedules} />;
      case "project":
        return (
          <ProjectTitle
            project={project}
            chat={chat}
            review={reviewOf(chat)}
            onError={setError}
          />
        );
    }
  }

  /** The page that's open, kept mounted but hidden under Settings. */
  function surfaceBody() {
    switch (nav.surface) {
      case "inbox":
        return (
          <div className="project-legacy" hidden={settings.open}>
            <PullRequestsArea
              hosts={pullsHosts}
              accountId={account?.id}
              pageRef={pullsPage.page}
              initialWorkspace={workspace}
              incomingLink={links.incoming}
              projects={projects.data ?? NO_PROJECTS}
              onOpenInProject={(p, ref) => void prs.openInProject(p, ref)}
              onOpenProject={(p) => navigate(p)}
              onAddProject={(repo) => void pullsPage.addProject(repo)}
              onLocation={pullsPage.setWhere}
              onConnectGitea={
                gitea ? () => void signIn.withAccount() : undefined
              }
            />
          </div>
        );
      case "usage":
        return (
          <div className="project-legacy" hidden={settings.open}>
            <UsagePage onOpenChat={openChatById} />
          </div>
        );
      case "processes":
        return (
          <div className="project-legacy" hidden={settings.open}>
            <ProcessesPage onOpenChat={openChatById} />
          </div>
        );
      case "schedules":
        return (
          <div className="project-legacy" hidden={settings.open}>
            <SchedulesPage
              projects={projects.data ?? NO_PROJECTS}
              projectId={nav.selected ?? undefined}
              initial={scheduleShown}
              onOpenChat={openChatById}
            />
          </div>
        );
      case "project":
        if (!project)
          return (
            <NoProject
              hidden={settings.open}
              onAdd={() => starts.addProject()}
              onScratch={() => void starts.scratch()}
            />
          );
        if (chat && poppedOut)
          return (
            <ThreadElsewhere
              key={chat.id}
              chat={chat}
              projectName={project.name}
              hidden={settings.open}
              onError={setError}
            />
          );
        return (
          <ThreadWorkspace
            tools={tools}
            project={project}
            projects={realProjects}
            allProjects={projects.data ?? NO_PROJECTS}
            everyThread={everyThread}
            composer={composer}
            gitActions={gitActions}
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
            onScratch={() => void starts.scratch()}
            onSettings={settings.show}
            onLinkProject={gitea ? () => void linkProject() : undefined}
          />
        );
    }
  }

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
          ) : (
            surfaceTitle()
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
                ? { inbox, usage, processes, schedules }
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
            onAdd={starts.addProject}
            onAttention={setAttention}
            onSettings={settings.show}
            onInbox={() => {
              // From the page itself it goes back to the board; from anywhere
              // else it returns to where the page was left.
              if (lock.blocked()) return;
              if (inbox) pullsPage.go({ to: "board" });
              else nav.setInbox(true);
            }}
            onUsage={toggleUsage}
            onProcesses={toggleProcesses}
            onSchedules={toggleSchedules}
          />
          {projects.error && <ErrorBox error={projects.error} />}
        </aside>
        {surfaceBody()}
        {settings.open && (
          <Settings
            account={account ?? null}
            initialCategory={settings.category}
            initialEntry={settings.entry}
            key={`${settings.project ?? "app"}:${settings.asked}`}
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
          kind={host.kind}
          error={host.error}
          checking={host.checking}
          onRecheck={host.recheck}
          onConnectGitea={gitea ? () => void linkProject() : undefined}
          onClose={() => setChoosePR(false)}
        />
      )}
      {starts.picking && (
        <NewThreadPicker
          projects={projects.data && realProjects}
          current={project?.id ?? null}
          onSelect={(p) => {
            starts.setPicking(false);
            starts.open(p);
          }}
          onAdd={() => starts.addProject()}
          onScratch={() => {
            starts.setPicking(false);
            void starts.scratch();
          }}
          onClose={() => starts.setPicking(false)}
        />
      )}
      {starts.adding && (
        <AddProjectPalette
          projects={realProjects}
          computerId={starts.addingOn}
          initialPage={starts.adding}
          onClose={() => starts.setAdding(false)}
          onDone={(p) => void starts.added(p)}
          onImportWithAgent={(app) => void starts.importThread(app)}
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
