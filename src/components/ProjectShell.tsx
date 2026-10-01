import { GitActions, type GitActionsHandle } from "./GitActions";
import { HandoffButton } from "./HandoffButton";
import { CiStatusIcon } from "./CiStatus";
import type { RelayCommand } from "../../shared/commands";
import { ProjectChanges, ProjectFiles } from "./ProjectViews";
import type { FileTarget } from "../lib/file-link-target";
import { ProjectHistory } from "./ProjectHistory";
import {
  NO_SLOTS,
  Pane,
  PaneHeader,
  PaneToggles,
  type PaneSlots,
} from "./WorkspacePanes";
import type { PaneId } from "../lib/workspace-panes";
import { useShellNavigation } from "../lib/useShellNavigation";
import { NO_VIEWING, useThreadView } from "../lib/useThreadView";
import type { TurnDiffTarget } from "../lib/turn-diff";
import {
  ShareConversation,
  JoinConversation,
  BrowseShared,
} from "./ProjectSharingDialogs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShortcut } from "../lib/shortcuts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderPlus,
  FolderGit2,
  MessageSquare,
  Files,
  Settings2,
  GitPullRequest,
  GitCompareArrows,
  GitGraph,
  Pencil,
} from "lucide-react";
import { parseRoomInvitation } from "../../shared/rooms";
import type { PullRef, Repo } from "../../shared/types";
import { type Project, type ChatSummary } from "../../shared/projects";
import { api } from "../lib/api";
import {
  clearDraftScope,
  freshNewThread,
  readDraft,
  writeDraft,
} from "../lib/drafts";
import { openThread, threadDraftKey } from "../lib/thread-storage";
import { sweepThreadStorage } from "../lib/thread-storage-sweep";
import {
  loadComposerSettings,
  saveComposerSettings,
} from "../lib/composer-settings";
import { Connected, SignIn } from "../ReviewSurface";
import { PullsTitle } from "./PullRequestsPage";
import {
  projectFor,
  repoKey,
  type PullsLocation,
  type PullsPageHandle,
  type PullsTarget,
} from "../lib/pull-board";
import { Settings } from "./Settings";
import { ErrorBox, IconButton, Loading, Modal } from "./ui";
import { ProjectChat } from "./ProjectChat";
import type { ComposerControls } from "./ProjectComposer";
import { sendDraft } from "../lib/draft-send";
import {
  matchLink,
  type ProjectFileLink,
} from "../../shared/project-file-links";
import { ProjectSidebar } from "./ProjectSidebar";
import { ProjectBadge } from "./ProjectBadge";
import { NewThreadPicker } from "./NewThreadPicker";
import { TerminalToggle, TitlebarBrand } from "./ShellTitlebar";
import { PaneResizer } from "./PaneResizer";
import { ProjectChecksButton } from "./ProjectChecks";
import { RunningTasks } from "./RunningTasks";
import { TerminalDrawer } from "./TerminalDrawer";
import { adoptDraftTerminal, terminalFor } from "../lib/thread-terminals";
import { fitHeader } from "../lib/header-fit";
import { useSidebarVisibility } from "../lib/useSidebarVisibility";
import { useThreadFolder } from "../lib/useThreadFolder";
import { useThreadTerminal } from "../lib/useThreadTerminal";
import { requestChannel } from "../lib/request-channel";
import {
  NavigationLockProvider,
  useNavigationLockRoot,
} from "../lib/navigation-lock";
import { SIDEBAR_WIDTH } from "../lib/settings-page";
import { useSettingsPage } from "../lib/useSettingsPage";
import { useSignIn } from "../lib/useSignIn";
import "./projects.css";
const NOWHERE: PullsLocation = { repo: null, pull: null };
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
  const projects = useQuery({
    queryKey: ["projects", boot.data?.account?.id],
    queryFn: () => api.projects(),
    refetchInterval: 5000,
    enabled: !!boot.data,
  });
  // Off the startup path; it asks for every thread list itself.
  useEffect(() => {
    if (!projects.data) return;
    const sweep = setTimeout(
      () => void sweepThreadStorage(api).catch(() => {}),
      3000,
    );
    return () => clearTimeout(sweep);
  }, [!!projects.data]);
  const gitActions = useRef<GitActionsHandle>(null);
  const chatComposer = useRef<ComposerControls>(null);
  const [choosePR, setChoosePR] = useState(false);
  const [error, setError] = useState<unknown>(),
    [incoming, setIncoming] = useState<{ url: string }>(),
    [queuedUrl, setQueuedUrl] = useState<string>();
  const lock = useNavigationLockRoot((message) => setError(new Error(message)));
  const view = useThreadView();
  const nav = useShellNavigation(projects.data, lock, view);
  const {
    project,
    chats,
    chat,
    chatId,
    setChatId,
    draftId,
    draftScope,
    pull,
    panes,
    navigate,
    openChat,
    newThreadIn,
  } = nav;
  const legacy = nav.inbox;
  // The Pull requests page reports where it is for the title; the title and
  // the sidebar send it back to the board.
  const [pullsWhere, setPullsWhere] = useState<PullsLocation>(NOWHERE);
  const pullsPage = useRef<PullsPageHandle>(null);
  const goToPulls = (target: PullsTarget) => {
    if (lock.blocked()) return;
    pullsPage.current?.go(target);
  };
  // The Pull requests page stands in for the chat alone.
  const sidebar = useSidebarVisibility(
    !legacy && panes.visible.some((id) => id !== "chat"),
  );
  const projectsHidden = sidebar.hidden;
  const [pickingProject, setPickingProject] = useState(false);
  const settings = useSettingsPage(nav.selected, chatId, legacy);
  // The sidebar's unread / needs-input dot, echoed on the brand while hidden.
  const [attention, setAttention] = useState<"waiting" | "unread">();
  const [changesSlots, setChangesSlots] = useState<PaneSlots>(NO_SLOTS);
  const [historySlots, setHistorySlots] = useState<PaneSlots>(NO_SLOTS);
  // Files the chat asks the Files and Changes panes to show. One per project,
  // so a file asked for in one never opens in the next.
  const fileOpens = useMemo(() => requestChannel<FileTarget>(), [project?.id]);
  const changeReveals = useMemo(
    () => requestChannel<ProjectFileLink>(),
    [project?.id],
  );
  const [share, setShare] = useState<ChatSummary>(),
    [invitation, setInvitation] = useState<string>(),
    [browseShared, setBrowseShared] = useState(false);
  // Scratchpad chats have their own sidebar section and never show as projects.
  const realProjects = projects.data?.filter((p) => !p.scratch) ?? [];
  const terminal = useThreadTerminal(nav);
  const codeOpen = panes.layout.open.changes || panes.layout.open.files;
  const folder = useThreadFolder(nav);
  const { where, checks } = folder;
  useEffect(() => {
    // The page took its link when it opened; coming back mustn't open it again.
    if (!legacy) setIncoming(undefined);
  }, [legacy]);
  function openUrl(url: string) {
    if (lock.blocked("Your link will open afterward.")) {
      setQueuedUrl(url);
      return;
    }
    try {
      const invitation = url.includes("#join=")
        ? parseRoomInvitation(url)
        : null;
      if (invitation?.conversation) setInvitation(url);
      else {
        setIncoming({ url });
        nav.setInbox(true);
      }
      if (!boot.data?.account) void signIn.withAccount();
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => api.onOpenUrl(openUrl), [boot.data?.account]);
  useEffect(() => {
    if (!lock.locked && queuedUrl) {
      setQueuedUrl(undefined);
      setError(undefined);
      openUrl(queuedUrl);
    }
  }, [lock.locked, queuedUrl]);
  useEffect(() => {
    if (boot.data?.pendingUrl) openUrl(boot.data.pendingUrl);
  }, [boot.data?.pendingUrl]);
  useShortcut("settings", true, () => settings.setOpen(true));
  useShortcut("new-thread", !!project && !legacy && !error, pickNewThread);
  useShortcut("new-scratch", true, () => void newScratch());
  async function add() {
    if (lock.blocked()) return;
    try {
      const p = await api.addProject();
      if (p) {
        await projects.refetch();
        nav.setSelected(p.id);
        nav.setInbox(false);
      }
    } catch (e) {
      setError(e);
    }
  }
  /**
   * A PR from the Pull requests page opens on its project's thread with the
   * Review beside it; opening it the first time makes that thread.
   */
  async function openPullInProject(p: Project, ref: PullRef) {
    if (!p.repository || lock.blocked()) return;
    // The project's spelling of its repository, which its threads use.
    const pr = {
      owner: p.repository.owner,
      name: p.repository.name,
      number: ref.number,
    };
    const chatsOf = () =>
      qc.fetchQuery({
        queryKey: ["project-chats", p.id],
        queryFn: () => api.projectChats(p.id),
        staleTime: 0,
      });
    try {
      let thread = (await chatsOf()).find(
        (c) => c.scope.kind === "pr" && c.scope.ref.number === pr.number,
      );
      if (!thread) {
        thread = await api.createProjectChat(p.id, { kind: "pr", ref: pr });
        await chatsOf();
      }
      navigate(p, thread);
      panes.show("changes");
    } catch (e) {
      setError(e);
    }
  }
  /** Adds a project from the Pull requests page; the PR open there moves to its thread. */
  async function addPullProject(repo?: Repo) {
    try {
      const p = await api.addProject();
      if (!p) return;
      await projects.refetch();
      if (!repo) return;
      if (!p.repository || repoKey(p.repository) !== repoKey(repo))
        throw new Error(
          `${p.name} is added, but it isn’t a clone of ${repo.owner}/${repo.name}.`,
        );
      if (pullsWhere.pull && pullsWhere.repo?.key === repoKey(repo))
        await openPullInProject(p, { ...repo, number: pullsWhere.pull.number });
    } catch (e) {
      setError(e);
    }
  }
  async function newChat(scope: ChatSummary["scope"] = { kind: "project" }) {
    if (!project) return;
    try {
      const next = await api.createProjectChat(project.id, scope);
      await chats.refetch();
      openChat(next.id);
      panes.show("chat");
      return next;
    } catch (e) {
      setError(e);
    }
  }
  async function discuss(ref: PullRef) {
    const existing = chats.data?.find(
      (c) => c.scope.kind === "pr" && c.scope.ref.number === ref.number,
    );
    if (existing) openChat(existing.id);
    else await newChat({ kind: "pr", ref });
    panes.show("chat");
  }
  /**
   * Reviewing a PR from the new thread makes it that PR's thread, taking the
   * unsent message and composer settings along, so a review started without
   * messages has a thread to come back to.
   */
  const startingReview = useRef(false);
  async function startReviewThread(ref: PullRef) {
    if (!project || startingReview.current) return;
    const existing = chats.data?.find(
      (c) => c.scope.kind === "pr" && c.scope.ref.number === ref.number,
    );
    if (existing) return setChatId(existing.id);
    startingReview.current = true;
    const from = draftId;
    try {
      const next = await api.createProjectChat(project.id, {
        kind: "pr",
        ref,
      });
      saveComposerSettings(next.id, loadComposerSettings(from));
      const draft = readDraft(threadDraftKey(from));
      if (draft) {
        writeDraft(threadDraftKey(next.id), draft);
        writeDraft(threadDraftKey(from), "");
      }
      await chats.refetch();
      setChatId(next.id);
    } catch (e) {
      setError(e);
    } finally {
      startingReview.current = false;
    }
  }
  const reviewOpen = panes.layout.open.changes;
  useEffect(() => {
    if (reviewOpen && pull && !chat && chats.data && !lock.locked)
      void startReviewThread(pull);
  }, [reviewOpen, pull?.number, chat?.id, !!chats.data]);
  function openCode(next: "changes" | "files") {
    panes.show(next === "files" || project?.plain ? "files" : "changes");
  }
  function togglePane(id: PaneId) {
    const open = panes.layout.open[id];
    if (open && id === "files" && lock.blocked()) return;
    panes.setOpen(id, !open);
    if (open && id !== "chat") view.setViewing(NO_VIEWING);
  }
  function openTurnDiff(target: TurnDiffTarget) {
    view.showTurn(target);
    panes.show("changes");
  }
  function openInEditor(target: ProjectFileLink & { search?: string }) {
    if (lock.blocked()) return;
    fileOpens.send(target);
    panes.show("files");
  }
  function revealChange(target: ProjectFileLink) {
    changeReveals.send(target);
    view.closeTurn();
    panes.show("changes");
  }
  // A file clicked in the chat shows its diff in Changes (Review in a PR
  // thread), or opens in Files when it has none. A name that fits several
  // files lists them in Files.
  async function openChatFile(target: ProjectFileLink) {
    if (pull) return revealChange(target);
    const id = where;
    try {
      const changes = project!.plain
        ? []
        : (folder.tree ?? (await api.projectWorkingTree(id))).changes.map(
            (c) => c.path,
          );
      const changed = matchLink(target, changes);
      if (target.directory ? changed.length : changed.length === 1)
        return revealChange(
          target.directory ? target : { ...target, path: changed[0] },
        );
      if (target.directory) return openInEditor(target);
      const found = matchLink(
        target,
        await qc.fetchQuery({
          queryKey: ["project-files", id],
          queryFn: () => api.projectFiles(id),
          staleTime: 5000,
        }),
      );
      // Ignored files (an agent's output folder) aren't in Git's list but are on disk.
      const onDisk =
        !found.length &&
        (await api.projectFileInfo(id, target.path).then(
          () => true,
          () => false,
        ));
      openInEditor(
        found.length === 1
          ? { ...target, path: found[0] }
          : onDisk
            ? target
            : { ...target, search: target.path },
      );
    } catch (e) {
      setError(e);
    }
  }
  /** ⌘N and the sidebar's New thread ask for the project unless there's only one. */
  function pickNewThread() {
    if (lock.blocked()) return;
    if (realProjects.length === 1) openNewThread(realProjects[0]);
    else if (realProjects.length) setPickingProject(true);
    else void newScratch();
  }
  /** ⌘⇧N: a chat about anything, in a folder of its own. */
  async function newScratch() {
    if (lock.blocked()) return;
    try {
      const p = await api.createScratch();
      await projects.refetch();
      openNewThread(p);
    } catch (e) {
      setError(e);
    }
  }
  function openNewThread(p: Project) {
    if (!navigate(p, undefined, true)) return;
    // After the new thread's composer mounts and a closing picker hands focus back.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => chatComposer.current?.focus()),
    );
  }
  /**
   * A new thread in the project folder on `text`: sent on the agent new
   * threads start with, or left as a draft to change first.
   */
  async function startThread(text: string, send: boolean) {
    if (!project || lock.blocked()) return;
    const id = freshNewThread(project.id);
    clearDraftScope(id);
    writeDraft(threadDraftKey(id), text);
    try {
      const sent =
        send &&
        (await sendDraft(qc, {
          key: threadDraftKey(id),
          id,
          project,
          reply: false,
        }));
      if (sent) {
        await chats.refetch();
        navigate(project, sent);
        return;
      }
    } catch (e) {
      setError(e);
    }
    navigate(project, undefined, id);
  }
  async function reviewBranchPr(ref: PullRef) {
    if (!project || lock.blocked()) return;
    await discuss(ref);
    panes.show("changes");
  }
  function runCommand(command: RelayCommand) {
    if (lock.blocked()) return false;
    if (command === "openpr") gitActions.current?.openPr();
    else if ((command === "new" || command === "clear") && project?.scratch)
      void newScratch();
    else if ((command === "new" || command === "clear") && project)
      navigate(project, undefined, true);
    else if (command === "files" || command === "changes") openCode(command);
    else return false;
    return true;
  }
  async function linked() {
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
  // A folder without Git has no changes or history to show.
  const paneOrder = project?.plain
    ? panes.layout.order.filter((id) => id === "chat" || id === "files")
    : panes.layout.order;
  const paneProps = (id: PaneId) => {
    const index = panes.visible.indexOf(id);
    const previous = index > 0 ? panes.visible[index - 1] : undefined;
    const total = panes.visible.reduce(
      (sum, pane) => sum + panes.layout.weights[pane],
      0,
    );
    return {
      open: panes.layout.open[id],
      order: panes.layout.order.indexOf(id),
      weight: panes.layout.weights[id],
      grow: panes.layout.weights[id] / (total || 1),
      previous: previous && {
        id: previous,
        weight: panes.layout.weights[previous],
      },
      onResize: panes.resize,
      onMove: panes.move,
    };
  };
  if (boot.error) return <ErrorBox error={boot.error} />;
  if (!boot.data) return <Loading text="Opening your workspace…" />;
  const account = boot.data.account;
  const page = (
    <div className={`app project-app platform-${boot.data.platform}`}>
      <header
        className={`titlebar project-titlebar ${projectsHidden && !settings.open ? "sidebar-collapsed" : ""}`}
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
          ) : legacy ? (
            <PullsTitle where={pullsWhere} onNav={goToPulls} />
          ) : (
            <div className="project-window-title">
              {project?.plain ? (
                <span className="ci-plain">
                  <ProjectBadge id={project.id} name={project.name} />
                </span>
              ) : project ? (
                <CiStatusIcon projectId={project.id} chatId={chat?.id}>
                  <ProjectBadge id={project.id} name={project.name} />
                </CiStatusIcon>
              ) : (
                <FolderGit2 size={14} />
              )}
              <span>{project?.name ?? "Workspace"}</span>
              <span className="breadcrumb-slash">/</span>
              {chat ? (
                <ThreadTitle
                  key={chat.id}
                  title={chat.title}
                  onRename={async (title) => {
                    const key = ["project-chats", chat.projectId];
                    qc.setQueryData<ChatSummary[]>(key, (list) =>
                      list?.map((c) =>
                        c.id === chat.id ? { ...c, title, renamed: true } : c,
                      ),
                    );
                    try {
                      await api.renameProjectChat(chat.id, title);
                    } catch (e) {
                      setError(e);
                    } finally {
                      void qc.invalidateQueries({ queryKey: key });
                    }
                  }}
                />
              ) : (
                <strong>{project?.scratch ? "New chat" : "New thread"}</strong>
              )}
            </div>
          )}
          <span className="spacer" />
          {!settings.open && !legacy && project && (
            <div className="thread-header-actions">
              <ProjectChecksButton
                quiet
                compact
                checks={checks}
                onOpenFile={(path, line) =>
                  openInEditor({ path, line, directory: false })
                }
              />
              {!project.plain && (
                <GitActions
                  key={where}
                  project={project}
                  where={where}
                  connected={!!account}
                  disabled={lock.locked}
                  ref={gitActions}
                  onConnect={() => void signIn.withAccount()}
                  onReview={(ref) => void reviewBranchPr(ref)}
                  onChanges={() => openCode("changes")}
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
                <PaneToggles
                  onToggle={togglePane}
                  onMove={panes.move}
                  panes={paneOrder.map((id) => ({
                    id,
                    open: panes.layout.open[id],
                    disabled:
                      (id === "files" &&
                        lock.locked &&
                        panes.layout.open.files) ||
                      (panes.layout.open[id] && panes.visible.length === 1),
                    ...(id === "chat"
                      ? { label: "Chat", icon: <MessageSquare size={14} /> }
                      : id === "files"
                        ? { label: "Files", icon: <Files size={14} /> }
                        : id === "history"
                          ? { label: "History", icon: <GitGraph size={14} /> }
                          : pull
                            ? {
                                label: `PR #${pull.number}`,
                                icon: <GitPullRequest size={14} />,
                              }
                            : {
                                label: "Changes",
                                icon: <GitCompareArrows size={14} />,
                                stat: folder.tree?.lines,
                              }),
                  }))}
                />
                <span className="header-strip-sep" aria-hidden="true" />
                <TerminalToggle terminal={terminal} />
              </div>
            </div>
          )}
          {projectsHidden && !settings.open && (
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
          className={`projects-sidebar ${projectsHidden ? "overlay" : ""} ${sidebar.peek ? "peek" : ""}`}
          aria-label="Projects"
          aria-hidden={projectsHidden && !sidebar.peek ? true : undefined}
          inert={projectsHidden && !sidebar.peek ? true : undefined}
          hidden={settings.open}
          onMouseEnter={projectsHidden ? sidebar.peekOpen : undefined}
          onMouseLeave={projectsHidden ? sidebar.peekClose : undefined}
        >
          <PaneResizer pane="sidebar" {...SIDEBAR_WIDTH} />
          <ProjectSidebar
            initialView={boot.data.sidebarView}
            projects={projects.data ?? []}
            showing={
              legacy
                ? { inbox: true }
                : {
                    projectId: project?.id,
                    chatId: chat?.id,
                    draftId: chat ? undefined : draftId,
                  }
            }
            account={account?.user.login}
            onOpen={navigate}
            onPickNew={pickNewThread}
            onNewScratch={() => void newScratch()}
            onSendDraft={() => chatComposer.current?.submit()}
            onAdd={() => void add()}
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
              else if (legacy) goToPulls({ to: "board" });
              else nav.setInbox(true);
            }}
          />
          {projects.error && <ErrorBox error={projects.error} />}
        </aside>
        {legacy && account ? (
          <div className="project-legacy" hidden={settings.open}>
            <Connected
              account={account}
              initialWorkspace={boot.data.workspace}
              incomingLink={incoming}
              pulls={{
                projects: projects.data ?? NO_PROJECTS,
                projectOf: (repo) =>
                  projectFor(
                    projects.data ?? NO_PROJECTS,
                    account.server,
                    repo,
                  ),
                onOpenInProject: (p, ref) => void openPullInProject(p, ref),
                onOpenProject: (p) => navigate(p),
                onAddProject: (repo) => void addPullProject(repo),
                onLocation: setPullsWhere,
              }}
              ref={pullsPage}
              onSettings={(category) =>
                settings.show(category === "rooms" ? category : undefined)
              }
            />
          </div>
        ) : !project ? (
          <main className="project-empty" hidden={settings.open}>
            <FolderGit2 size={40} />
            <h1>Your project. Your conversation.</h1>
            <p>
              Open a project folder to edit, review changes and chat with your
              agent.
              <br />
              Connect Gitea when you’re ready to review pull requests together.
            </p>
            <button className="primary" onClick={() => void add()}>
              <FolderPlus size={16} />
              Add project folder
            </button>
            <button className="text-button" onClick={() => void newScratch()}>
              Or just chat in Scratchpad
            </button>
          </main>
        ) : (
          <div className="workspace-column" hidden={settings.open}>
            <div className="workspace-panes">
              <Pane
                id="chat"
                label="Chat"
                {...paneProps("chat")}
                className="project-chat-pane"
              >
                <ProjectChat
                  key={chat?.id ?? draftId}
                  ref={chatComposer}
                  project={project}
                  draftId={draftId}
                  onCommand={runCommand}
                  projects={realProjects}
                  chat={chat}
                  draftScope={draftScope}
                  viewing={codeOpen ? view.viewing : NO_VIEWING}
                  contextText={view.context}
                  onContextUsed={() => view.setContext(undefined)}
                  onShare={() => {
                    if (chat) void signIn.withAccount(() => setShare(chat));
                  }}
                  onDraftWorkspace={nav.setDraftWorkspace}
                  onStartThread={startThread}
                  onCreated={async (c) => {
                    if (!c.worktree) adoptDraftTerminal(project.id, c.id);
                    await chats.refetch();
                    setChatId(c.id);
                  }}
                  onRepository={() => newThreadIn({ kind: "project" })}
                  onChoosePR={() => {
                    if (!lock.blocked()) setChoosePR(true);
                  }}
                  onSelectPR={(ref) => newThreadIn({ kind: "pr", ref })}
                  onDeepReview={() => newThreadIn({ kind: "review" })}
                  onSwitchProject={(next) => navigate(next, undefined, true)}
                  onAddProject={() => void add()}
                  canChoosePR={!!account && !!project.repository}
                  onOpenCode={openCode}
                  onOpenFile={openChatFile}
                  onOpenTurnDiff={openTurnDiff}
                />
                <RunningTasks
                  key={project.id}
                  project={project}
                  chats={chats.data ?? []}
                  onOpenChat={(c) => navigate(project, c)}
                />
              </Pane>
              <Pane id="changes" label="Changes" {...paneProps("changes")}>
                {panes.layout.open.changes && (
                  <>
                    <PaneHeader
                      id="changes"
                      icon={
                        pull ? (
                          <GitPullRequest size={14} />
                        ) : (
                          <GitCompareArrows size={14} />
                        )
                      }
                      title={pull ? "Review" : "Changes"}
                      detail={pull ? undefined : folder.detail}
                      onSlots={setChangesSlots}
                      onClose={() => togglePane("changes")}
                    />
                    {pull ? (
                      account && project.repository ? (
                        <div className="project-review">
                          <Connected
                            key={`${project.id}:${pull.number}`}
                            embedded={{
                              ref: pull,
                              workspace: where,
                              slots: changesSlots,
                              onEditFile: (path, line) =>
                                openInEditor({ path, line, directory: false }),
                              reveals: changeReveals,
                              onPresence: (next) => {
                                view.setViewing(next);
                                if (next.path)
                                  localStorage.setItem(
                                    `relay-project-review-file:${project.id}:${pull.number}`,
                                    next.path,
                                  );
                              },
                              onDiscuss: (target, selectedPull) => {
                                void discuss(selectedPull)
                                  .then(() => {
                                    view.setContext({
                                      id: crypto.randomUUID(),
                                      text: `About ${target.path}:${target.start}${target.end !== target.start ? `–${target.end}` : ""} (${target.side === "deletions" ? "before PR" : "PR head"})\n\n`,
                                      selection: {
                                        ...target,
                                        head: selectedPull.head.sha,
                                        base: selectedPull.merge_base,
                                        question: "Explain this code.",
                                      },
                                    });
                                    panes.show("chat");
                                  })
                                  .catch(setError);
                              },
                            }}
                            account={account}
                            initialWorkspace={{
                              ...boot.data.workspace,
                              pull,
                              file: localStorage.getItem(
                                `relay-project-review-file:${project.id}:${pull.number}`,
                              ),
                            }}
                            onSettings={() => settings.setOpen(true)}
                          />
                        </div>
                      ) : (
                        <div className="empty pane-empty">
                          <GitPullRequest size={28} />
                          <h2>Connect your Git host</h2>
                          <p>
                            We’ll match the repository using this folder’s Git
                            remote.
                          </p>
                          <button onClick={() => void linked()}>
                            Connect Gitea
                          </button>
                        </div>
                      )
                    ) : (
                      <ProjectChanges
                        key={where}
                        where={where}
                        slots={changesSlots}
                        onViewing={view.setViewing}
                        onOpenFile={(path, line) =>
                          openInEditor({ path, line, directory: false })
                        }
                        turn={view.turnDiff}
                        onCloseTurn={() => view.closeTurn()}
                        reveals={changeReveals}
                        onAsk={(code) => {
                          view.setContext({
                            id: crypto.randomUUID(),
                            text: "",
                            code,
                          });
                          panes.show("chat");
                        }}
                      />
                    )}
                  </>
                )}
              </Pane>
              <Pane id="files" label="Files" {...paneProps("files")}>
                {panes.layout.open.files && (
                  <>
                    <PaneHeader
                      id="files"
                      icon={<Files size={14} />}
                      title="Files"
                      detail={folder.detail}
                      closeDisabled={lock.locked}
                      onClose={() => togglePane("files")}
                    />
                    <ProjectFiles
                      key={where}
                      project={project}
                      where={where}
                      checks={checks}
                      onViewing={view.setViewing}
                      opens={fileOpens}
                    />
                  </>
                )}
              </Pane>
              <Pane id="history" label="History" {...paneProps("history")}>
                {panes.layout.open.history && (
                  <>
                    <PaneHeader
                      id="history"
                      icon={<GitGraph size={14} />}
                      title="History"
                      detail={folder.detail}
                      onSlots={setHistorySlots}
                      onClose={() => togglePane("history")}
                    />
                    <ProjectHistory
                      key={where}
                      projectId={where}
                      slots={historySlots}
                      onOpenFile={(path) =>
                        openInEditor({ path, directory: false })
                      }
                    />
                  </>
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
          <button onClick={() => void linked()}>Connect Gitea</button>
        </Modal>
      )}
      {pickingProject && (
        <NewThreadPicker
          projects={realProjects}
          current={project?.id ?? null}
          onSelect={(p) => {
            setPickingProject(false);
            openNewThread(p);
          }}
          onAdd={() => void add()}
          onClose={() => setPickingProject(false)}
        />
      )}
      {signIn.open && (
        <Modal
          title="Gitea account"
          className="project-signin"
          onClose={signIn.cancel}
        >
          <SignIn
            onConnected={signIn.connected}
            loginRestore={boot.data.loginRestore}
            savedServer={boot.data.savedServer}
            invitationUrl={incoming?.url}
            platform={boot.data.platform}
            onRestoreAction={async (action) => {
              if (action === "retry") await api.retryLoginRestore();
              else await api.cancelLoginRestore();
              await boot.refetch();
            }}
          />
        </Modal>
      )}
      {invitation && (
        <JoinConversation
          url={invitation}
          projects={projects.data ?? []}
          account={account ?? null}
          onAdd={add}
          onSignIn={() => void signIn.withAccount()}
          onClose={() => setInvitation(undefined)}
          onJoined={async (p, c) => {
            if (c) openThread.save(p, c.id);
            nav.setSelected(p);
            await chats.refetch();
            if (c) openChat(c.id);
            nav.setInbox(false);
            panes.show("chat");
            setInvitation(undefined);
          }}
        />
      )}
      {browseShared && project && (
        <BrowseShared
          project={project}
          onClose={() => setBrowseShared(false)}
          onOpen={async (c) => {
            await chats.refetch();
            openChat(c.id);
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

/** The header's thread name; double-click or use the pencil to rename it. */
function ThreadTitle({
  title,
  onRename,
}: {
  title: string;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = value.replace(/\s+/g, " ").trim();
    if (commit && next && next !== title) onRename(next);
  };
  const edit = () => {
    done.current = false;
    setValue(title);
    setEditing(true);
  };
  if (!editing)
    return (
      <div className="thread-title">
        <strong title="Double-click to rename" onDoubleClick={edit}>
          {title}
        </strong>
        <button
          type="button"
          className="icon-button thread-title-edit"
          title="Rename thread"
          aria-label="Rename thread"
          onClick={edit}
        >
          <Pencil size={12} />
        </button>
      </div>
    );
  return (
    <input
      autoFocus
      className="thread-title-input"
      aria-label="Thread name"
      maxLength={120}
      value={value}
      size={Math.max(value.length, 8)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
