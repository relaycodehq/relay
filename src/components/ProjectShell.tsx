import { GitActions } from "./GitActions";
import { workspaceId } from "../../shared/workspaces";
import { CiStatusIcon } from "./CiStatus";
import type { RelayCommand } from "../../shared/commands";
import { ProjectChanges, ProjectFiles, type FileTarget } from "./ProjectViews";
import { ProjectHistory } from "./ProjectHistory";
import type { TurnDiffTarget } from "./TurnChanges";
import {
  NO_SLOTS,
  Pane,
  PaneHeader,
  PaneToggles,
  type PaneSlots,
} from "./WorkspacePanes";
import { useWorkspacePanes, type PaneId } from "../lib/workspace-panes";
import { workingTreeKey } from "../lib/working-tree-key";
import {
  ShareConversation,
  JoinConversation,
  BrowseShared,
} from "./ProjectSharingDialogs";
import type { LineQuestion } from "../../shared/questions";
import { useEffect, useRef, useState } from "react";
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
  PanelBottom,
  Pencil,
} from "lucide-react";
import { parseRoomInvitation } from "../../shared/rooms";
import type { Account, PullRef } from "../../shared/types";
import {
  chatScopeSchema,
  type ChatWorkspace,
  type Project,
  type ChatSummary,
} from "../../shared/projects";
import { api } from "../lib/api";
import { Connected, SignIn } from "../ReviewSurface";
import { Settings, type SettingsCategory } from "./Settings";
import { ErrorBox, IconButton, Loading, Modal } from "./ui";
import { ProjectChat } from "./ProjectChat";
import type { CodeReference } from "../../shared/code-references";
import {
  matchLink,
  type ProjectFileLink,
} from "../../shared/project-file-links";
import { ProjectSidebar } from "./ProjectSidebar";
import { ProjectBadge } from "./ProjectBadge";
import { NewThreadPicker } from "./NewThreadPicker";
import { RelayMark } from "./RelayMark";
import { PaneResizer } from "./PaneResizer";
import { ProjectChecksButton } from "./ProjectChecks";
import { RunningTasks } from "./RunningTasks";
import { TerminalDrawer } from "./TerminalDrawer";
import {
  adoptDraftTerminal,
  isToggleShortcut,
  setTerminalOpen,
  terminalFor,
  terminalKey,
  useTerminalOpen,
} from "../lib/thread-terminals";
import { useProjectChecks } from "../lib/useProjectChecks";
import { useSidebarAutoHide } from "../lib/sidebar-auto-hide";
import { agentsSince } from "../../shared/waiting";
import "./projects.css";
const NO_VIEWING = { path: null, viewed: 0, total: 0 };
const WORKTREE_PENDING =
  "The terminal opens in this thread's worktree, which its first message makes";
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
  useEffect(() => {
    if (boot.data?.account) setSignin(false);
  }, [boot.data?.account?.id]);
  const projects = useQuery({
    queryKey: ["projects", boot.data?.account?.id],
    queryFn: () => api.projects(),
    refetchInterval: 5000,
    enabled: !!boot.data,
  });
  const [selected, setSelected] = useState(() =>
      localStorage.getItem("relay-project-id"),
    ),
    [chatId, setChatId] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState<ChatSummary["scope"]>({
    kind: "project",
  });
  const [draftWorkspace, setDraftWorkspace] =
    useState<ChatWorkspace>("checkout");
  const [openPrRequest, setOpenPrRequest] = useState(0);
  const [choosePR, setChoosePR] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>();
  const [settings, setSettings] = useState(false),
    [signin, setSignin] = useState(false),
    [error, setError] = useState<unknown>(),
    [legacy, setLegacy] = useState(
      () => localStorage.getItem("relay-surface") === "inbox",
    ),
    [incoming, setIncoming] = useState<{ url: string }>(),
    [queuedUrl, setQueuedUrl] = useState<string>();
  const [projectsHidden, setProjectsHidden] = useState(
    () => localStorage.getItem("relay-projects-hidden") === "true",
  );
  // While the sidebar is hidden, hovering the brand toggle peeks it as an overlay.
  const [peek, setPeek] = useState(false);
  const [pickingProject, setPickingProject] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const peekOpen = () => {
    window.clearTimeout(peekTimer.current);
    if (projectsHidden) setPeek(true);
  };
  const peekClose = () => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(false), 250);
  };
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);
  // The sidebar's unread / needs-input dot, echoed on the brand while hidden.
  const [attention, setAttention] = useState<"waiting" | "unread">();
  const panes = useWorkspacePanes();
  const [changesSlots, setChangesSlots] = useState<PaneSlots>(NO_SLOTS);
  const [historySlots, setHistorySlots] = useState<PaneSlots>(NO_SLOTS);
  const [dirty, setDirty] = useState(false),
    [openFileTarget, setOpenFileTarget] = useState<FileTarget | null>(null),
    [changeTarget, setChangeTarget] = useState<FileTarget | null>(null),
    [turnDiff, setTurnDiff] = useState<
      (TurnDiffTarget & { request: number }) | null
    >(null),
    [viewing, setViewing] = useState<{
      path: string | null;
      viewed: number;
      total: number;
    }>({ path: null, viewed: 0, total: 0 }),
    [contextText, setContextText] = useState<{
      id: string;
      text: string;
      selection?: LineQuestion;
      code?: CodeReference;
    }>(),
    [share, setShare] = useState<ChatSummary>(),
    [invitation, setInvitation] = useState<string>(),
    [browseShared, setBrowseShared] = useState(false);
  const [restoredProject, setRestoredProject] = useState<string>();
  const project =
    projects.data?.find((p) => p.id === selected) ??
    projects.data?.find((p) => !p.scratch) ??
    projects.data?.[0];
  // Scratchpad chats have their own sidebar section and never show as projects.
  const realProjects = projects.data?.filter((p) => !p.scratch) ?? [];
  const chats = useQuery({
    queryKey: ["project-chats", project?.id],
    queryFn: () => api.projectChats(project!.id),
    enabled: !!project,
  });
  const chat = chats.data?.find((c) => c.id === chatId);
  // A PR thread reviews its PR; any other thread shows the working tree.
  const scope = chat?.scope ?? draftScope;
  const pull = scope.kind === "pr" ? scope.ref : null;
  const shellKey = project ? terminalKey(project.id, chat?.id ?? null) : "";
  const terminalOpen = useTerminalOpen(shellKey);
  // A thread's terminal works where its files are: a worktree thread has
  // none until its first message makes the worktree.
  const terminalBlocked = chat?.worktree
    ? chat.worktree.removedAt
      ? "This thread's worktree was removed. Its next message makes a new one"
      : !chat.worktree.path
        ? WORKTREE_PENDING
        : undefined
    : !chat && scope.kind === "project" && draftWorkspace === "worktree"
      ? WORKTREE_PENDING
      : undefined;
  const showTerminal = !!project && !legacy && terminalOpen && !terminalBlocked;
  function toggleTerminal() {
    if (!project || legacy || terminalBlocked) return;
    if (!terminalOpen)
      terminalFor(project.id, chat?.id ?? null).focusOnShow = true;
    setTerminalOpen(shellKey, !terminalOpen);
  }
  const toggleTerminalRef = useRef(toggleTerminal);
  toggleTerminalRef.current = toggleTerminal;
  const codeOpen = panes.layout.open.changes || panes.layout.open.files;
  // Git and file panes follow the thread: its worktree once it has one.
  const inWorktree =
    !!chat?.worktree?.path && !chat.worktree.removedAt ? chat : undefined;
  const where = project ? workspaceId(project.id, inWorktree?.id) : "";
  const worktreeDetail = inWorktree && {
    text: "worktree",
    title: `${inWorktree.worktree!.branch} · ${inWorktree.worktree!.path}`,
  };
  // The one poller for the working tree: panes, pickers and the chat read this
  // cache. Every polling observer would run its own round of Git commands.
  const tree = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
    enabled: !!project && !legacy && !project.plain,
    refetchInterval: 3000,
  });
  // Live checks for the working tree. A PR thread's review runs its own checks
  // (one session at a time), so the working-tree checks stand aside there.
  const checks = useProjectChecks(
    undefined,
    project && tree.data && !legacy && !pull
      ? { id: where, head: tree.data.head }
      : undefined,
    // An agent rewriting files would trigger a recheck on every save.
    !!chats.data?.some((c) => c.running || agentsSince(c.pending)),
  );
  useEffect(() => {
    if (project) {
      localStorage.setItem("relay-project-id", project.id);
      const saved = localStorage.getItem("relay-project-chat:" + project.id);
      setChatId(saved || null);
      try {
        const stored = chatScopeSchema.safeParse(
          JSON.parse(
            localStorage.getItem("relay-draft-scope:" + project.id) || "null",
          ),
        );
        setDraftScope(stored.success ? stored.data : { kind: "project" });
      } catch {
        setDraftScope({ kind: "project" });
      }
      panes.closeCode();
      setTurnDiff(null);
      setRestoredProject(project.id);
      setDirty(false);
    }
  }, [project?.id]);
  useEffect(() => {
    if (project && project.id === restoredProject)
      localStorage.setItem(
        "relay-draft-scope:" + project!.id,
        JSON.stringify(draftScope),
      );
  }, [draftScope, project?.id, restoredProject]);
  useEffect(() => {
    localStorage.setItem("relay-surface", legacy ? "inbox" : "project");
  }, [legacy]);
  useEffect(() => {
    if (project && project.id === restoredProject)
      localStorage.setItem("relay-project-chat:" + project.id, chatId ?? "");
  }, [project?.id, chatId, restoredProject]);
  // Opening a side pane hides the sidebar for room; closing them all brings it
  // back, unless the user toggled it themselves in between.
  const autoHide = useSidebarAutoHide();
  const autoHidden = useRef(false);
  const sidePaneOpen = panes.visible.some((id) => id !== "chat");
  useEffect(() => {
    if (sidePaneOpen && autoHide && !projectsHidden) {
      autoHidden.current = true;
      setProjectsHidden(true);
    } else if (!sidePaneOpen && autoHidden.current) {
      autoHidden.current = false;
      setProjectsHidden(false);
    }
  }, [sidePaneOpen]);
  useEffect(() => {
    // A sidebar hidden only for a pane shouldn't stay hidden after a restart.
    localStorage.setItem(
      "relay-projects-hidden",
      String(projectsHidden && !autoHidden.current),
    );
  }, [projectsHidden]);
  function openUrl(url: string) {
    if (dirty) {
      setQueuedUrl(url);
      setError(
        new Error(
          "Save or close the edited file first. Your link will open afterward.",
        ),
      );
      return;
    }
    try {
      const invitation = url.includes("#join=")
        ? parseRoomInvitation(url)
        : null;
      if (invitation?.conversation) setInvitation(url);
      else {
        setIncoming({ url });
        setLegacy(true);
      }
      if (!boot.data?.account) setSignin(true);
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => api.onOpenUrl(openUrl), [boot.data?.account, dirty]);
  useEffect(() => {
    if (!dirty && queuedUrl) {
      setQueuedUrl(undefined);
      setError(undefined);
      openUrl(queuedUrl);
    }
  }, [dirty, queuedUrl]);
  useEffect(() => {
    if (boot.data?.pendingUrl) openUrl(boot.data.pendingUrl);
  }, [boot.data?.pendingUrl]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isToggleShortcut(e)) {
        e.preventDefault();
        toggleTerminalRef.current();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettings(true);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        !e.isComposing &&
        e.key.toLowerCase() === "n" &&
        project &&
        !legacy &&
        !dirty &&
        !error &&
        // Modal <dialog>s have no role attribute; popovers do.
        !document.querySelector('dialog[open], [role="dialog"]')
      ) {
        e.preventDefault();
        pickNewThread();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.shiftKey &&
        !e.isComposing &&
        e.key.toLowerCase() === "n" &&
        !dirty &&
        !document.querySelector('dialog[open], [role="dialog"]')
      ) {
        e.preventDefault();
        void newScratch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project?.id, projects.data, legacy, dirty, error]);
  async function add() {
    try {
      const p = await api.addProject();
      if (p) {
        await projects.refetch();
        setSelected(p.id);
        setLegacy(false);
      }
    } catch (e) {
      setError(e);
    }
  }
  async function newChat(scope: ChatSummary["scope"] = { kind: "project" }) {
    if (!project) return;
    try {
      const next = await api.createProjectChat(project.id, scope);
      await chats.refetch();
      setChatId(next.id);
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
    if (existing) setChatId(existing.id);
    else await newChat({ kind: "pr", ref });
    panes.show("chat");
  }
  function openCode(next: "changes" | "files") {
    panes.show(next === "files" || project?.plain ? "files" : "changes");
  }
  function togglePane(id: PaneId) {
    const open = panes.layout.open[id];
    if (open && id === "files" && dirty) return;
    panes.setOpen(id, !open);
    if (open && id !== "chat") setViewing(NO_VIEWING);
  }
  function openTurnDiff(target: TurnDiffTarget) {
    setTurnDiff((previous) => ({
      ...target,
      request: (previous?.request ?? 0) + 1,
    }));
    panes.show("changes");
  }
  function openInEditor(target: ProjectFileLink & { search?: string }) {
    if (dirty) {
      setError(
        new Error("Save or close the edited file before opening another file."),
      );
      return;
    }
    setOpenFileTarget((previous) => ({
      ...target,
      projectId: project!.id,
      request: (previous?.request ?? 0) + 1,
    }));
    panes.show("files");
  }
  function revealChange(target: ProjectFileLink) {
    setChangeTarget((previous) => ({
      ...target,
      projectId: project!.id,
      request: (previous?.request ?? 0) + 1,
    }));
    setTurnDiff(null);
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
        : (tree.data ?? (await api.projectWorkingTree(id))).changes.map(
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
      openInEditor(
        found.length === 1
          ? { ...target, path: found[0] }
          : { ...target, search: target.path },
      );
    } catch (e) {
      setError(e);
    }
  }
  /**
   * Opens `next`, or with `fresh` the project's new thread: a fresh one on
   * the repository, or with "draft" the unsent one in the scope it was
   * written for.
   */
  function navigate(
    p: Project,
    next?: ChatSummary,
    fresh: boolean | "draft" = false,
  ) {
    if (dirty) return;
    if (fresh || next)
      localStorage.setItem("relay-project-chat:" + p.id, next?.id ?? "");
    // Switching projects restores the saved scope, so a fresh thread drops it.
    if (fresh === true) localStorage.removeItem("relay-draft-scope:" + p.id);
    setSelected(p.id);
    if (next || fresh) setChatId(next?.id ?? null);
    setLegacy(false);
    panes.closeCode();
    setTurnDiff(null);
    setContextText(undefined);
    setViewing(NO_VIEWING);
    if (fresh === true) setDraftScope({ kind: "project" });
  }
  /** ⌘N and the sidebar's New thread ask for the project unless there's only one. */
  function pickNewThread() {
    if (dirty) return;
    if (realProjects.length === 1) openNewThread(realProjects[0]);
    else if (realProjects.length) setPickingProject(true);
    else void newScratch();
  }
  /** ⌘⇧N: a chat about anything, in a folder of its own. */
  async function newScratch() {
    if (dirty) return;
    try {
      const p = await api.createScratch();
      await projects.refetch();
      openNewThread(p);
    } catch (e) {
      setError(e);
    }
  }
  function openNewThread(p: Project) {
    navigate(p, undefined, true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(
            '.project-chat-pane [contenteditable="true"][aria-label="Message project"]',
          )
          ?.focus(),
      ),
    );
  }
  /** A thread keeps the scope it started with; another one takes a new thread. */
  function newThreadIn(scope: ChatSummary["scope"]) {
    if (dirty) return;
    setChatId(null);
    setDraftScope(scope);
  }
  async function reviewBranchPr(ref: PullRef) {
    if (!project || dirty) return;
    await discuss(ref);
    panes.show("changes");
  }
  function runCommand(command: RelayCommand) {
    if (dirty) {
      setError(new Error("Save or close your edited file first."));
      return false;
    }
    if (command === "openpr") setOpenPrRequest((n) => n + 1);
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
    if (!boot.data?.account) {
      setSignin(true);
      return;
    }
    try {
      await api.linkProject(project.id);
      await projects.refetch();
    } catch (e) {
      setError(e);
    }
  }
  const connected = async (account: Account) => {
    const next = await api.bootstrap();
    qc.removeQueries({
      predicate: (q) =>
        !["bootstrap", "project-chat", "project-chats"].includes(
          String(q.queryKey[0]),
        ),
    });
    qc.setQueryData(["bootstrap"], { ...next, account });
    setSignin(false);
  };
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
  return (
    <div className={`app project-app platform-${boot.data.platform}`}>
      <header
        className={`titlebar project-titlebar ${projectsHidden ? "sidebar-collapsed" : ""}`}
      >
        <div className="project-titlebar-brand">
          <span className="traffic-space" />
          <button
            type="button"
            className="relay-brand-toggle"
            title="Toggle projects"
            aria-label="Toggle projects"
            aria-pressed={!projectsHidden}
            onClick={() => {
              window.clearTimeout(peekTimer.current);
              setPeek(false);
              autoHidden.current = false;
              setProjectsHidden((v) => !v);
            }}
            onMouseEnter={peekOpen}
            onMouseLeave={peekClose}
          >
            <span className="relay-brand-mark">
              <RelayMark />
              {projectsHidden && attention && (
                <span
                  className={`sb-status ${attention} relay-brand-dot`}
                  title={
                    attention === "waiting"
                      ? "Needs your input"
                      : "New activity"
                  }
                >
                  <i />
                </span>
              )}
            </span>
            <strong>Relay</strong>
          </button>
        </div>
        {legacy ? (
          <button
            className="text-button"
            disabled={dirty}
            onClick={() => setLegacy(false)}
          >
            <FolderGit2 size={15} />
            Back to projects
          </button>
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
        {!legacy && project && (
          <div className="thread-header-actions">
            <ProjectChecksButton
              quiet
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
                disabled={dirty}
                request={openPrRequest}
                onConnect={() => setSignin(true)}
                onReview={(ref) => void reviewBranchPr(ref)}
                onChanges={() => openCode("changes")}
                onError={setError}
              />
            )}
            <PaneToggles
              onToggle={togglePane}
              onMove={panes.move}
              panes={paneOrder.map((id) => ({
                id,
                open: panes.layout.open[id],
                disabled:
                  (id === "files" && dirty && panes.layout.open.files) ||
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
                            stat: tree.data?.lines,
                          }),
              }))}
            />
            <div
              className="pane-toggles"
              title={
                terminalBlocked ??
                `${terminalOpen ? "Hide" : "Show"} terminal (${
                  boot.data.platform === "darwin" ? "⌘J" : "Ctrl+`"
                })`
              }
            >
              <button
                type="button"
                className={`pane-toggle ${showTerminal ? "active" : ""}`}
                aria-label="Terminal"
                aria-pressed={showTerminal}
                disabled={!!terminalBlocked}
                onClick={toggleTerminal}
              >
                <PanelBottom size={14} />
              </button>
            </div>
          </div>
        )}
        {projectsHidden && !legacy && (
          <IconButton label="Open settings" onClick={() => setSettings(true)}>
            <Settings2 size={16} />
          </IconButton>
        )}
      </header>
      <div className="project-layout">
        <aside
          className={`projects-sidebar ${projectsHidden ? "overlay" : ""} ${peek ? "peek" : ""}`}
          aria-label="Projects"
          aria-hidden={projectsHidden && !peek ? true : undefined}
          inert={projectsHidden && !peek ? true : undefined}
          hidden={legacy}
          onMouseEnter={projectsHidden ? peekOpen : undefined}
          onMouseLeave={projectsHidden ? peekClose : undefined}
        >
          <PaneResizer pane="sidebar" initial={250} min={210} max={360} />
          <ProjectSidebar
            projects={projects.data ?? []}
            projectId={project?.id}
            chatId={chat?.id}
            dirty={dirty}
            account={account?.user.login}
            onChat={(c) => {
              const p = projects.data?.find((p) => p.id === c.projectId);
              if (p) navigate(p, c);
            }}
            onNew={(p) => navigate(p, undefined, true)}
            onPickNew={pickNewThread}
            onNewScratch={() => void newScratch()}
            onDraft={(p) => navigate(p, undefined, "draft")}
            onAdd={() => void add()}
            onShared={(p) => {
              navigate(p);
              setBrowseShared(true);
            }}
            onAttention={setAttention}
            onSettings={(category) => {
              setSettingsCategory(category);
              setSettings(true);
            }}
            onAccount={() => setSignin(true)}
            onInbox={() => {
              if (account) setLegacy(true);
              else setSignin(true);
            }}
          />
          {projects.error && <ErrorBox error={projects.error} />}
        </aside>
        {legacy && account ? (
          <div className="project-legacy">
            <Connected
              onDirtyChange={setDirty}
              account={account}
              initialWorkspace={boot.data.workspace}
              incomingLink={incoming}
              onSettings={(category) => {
                setSettingsCategory(
                  category === "rooms" ? category : undefined,
                );
                setSettings(true);
              }}
            />
          </div>
        ) : !project ? (
          <main className="project-empty">
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
          <div className="workspace-column">
            <div className="workspace-panes">
              <Pane
                id="chat"
                label="Chat"
                {...paneProps("chat")}
                className="project-chat-pane"
              >
                <ProjectChat
                  key={chat?.id ?? `new:${project.id}`}
                  project={project}
                  onCommand={runCommand}
                  projects={realProjects}
                  chat={chat}
                  draftScope={draftScope}
                  viewing={codeOpen ? viewing : NO_VIEWING}
                  contextText={contextText}
                  onContextUsed={() => setContextText(undefined)}
                  onShare={() => {
                    if (chat) setShare(chat);
                  }}
                  onDraftWorkspace={setDraftWorkspace}
                  onCreated={async (c) => {
                    if (!c.worktree) adoptDraftTerminal(project.id, c.id);
                    await chats.refetch();
                    setChatId(c.id);
                  }}
                  onRepository={() => newThreadIn({ kind: "project" })}
                  onChoosePR={() => {
                    if (!dirty) setChoosePR(true);
                  }}
                  onSelectPR={(ref) => newThreadIn({ kind: "pr", ref })}
                  onDeepReview={() => newThreadIn({ kind: "review" })}
                  onSwitchProject={(next) => navigate(next, undefined, true)}
                  onAddProject={() => void add()}
                  canChoosePR={!!account && !!project.repository}
                  dirty={dirty}
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
                      detail={pull ? undefined : worktreeDetail}
                      onSlots={setChangesSlots}
                      onClose={() => togglePane("changes")}
                    />
                    {pull ? (
                      account && project.repository ? (
                        <div className="project-review">
                          <Connected
                            onDirtyChange={setDirty}
                            key={`${project.id}:${pull.number}`}
                            embedded={{
                              ref: pull,
                              workspace: where,
                              slots: changesSlots,
                              onEditFile: (path, line) =>
                                openInEditor({ path, line, directory: false }),
                              reveal:
                                changeTarget?.projectId === project.id
                                  ? changeTarget
                                  : null,
                              onRevealConsumed: () => setChangeTarget(null),
                              onPresence: (next) => {
                                setViewing(next);
                                if (next.path)
                                  localStorage.setItem(
                                    `relay-project-review-file:${project.id}:${pull.number}`,
                                    next.path,
                                  );
                              },
                              onDiscuss: (target, selectedPull) => {
                                void discuss(selectedPull)
                                  .then(() => {
                                    setContextText({
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
                            onSettings={() => setSettings(true)}
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
                        project={project}
                        where={where}
                        slots={changesSlots}
                        onViewing={setViewing}
                        onOpenFile={(path, line) =>
                          openInEditor({ path, line, directory: false })
                        }
                        turn={turnDiff}
                        onCloseTurn={() => setTurnDiff(null)}
                        reveal={changeTarget}
                        onRevealConsumed={() => setChangeTarget(null)}
                        onAsk={(code) => {
                          setContextText({
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
                      detail={worktreeDetail}
                      closeDisabled={dirty}
                      onClose={() => togglePane("files")}
                    />
                    <ProjectFiles
                      key={where}
                      project={project}
                      where={where}
                      checks={checks}
                      dirty={dirty}
                      onDirtyChange={setDirty}
                      onViewing={setViewing}
                      openTarget={openFileTarget}
                      onOpenTargetConsumed={() => setOpenFileTarget(null)}
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
                      detail={worktreeDetail}
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
            {showTerminal && (
              <TerminalDrawer
                terminal={terminalFor(project.id, chat?.id ?? null)}
                worktree={!!chat?.worktree}
                onClose={() => setTerminalOpen(shellKey, false)}
              />
            )}
          </div>
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
      {settings && (
        <Settings
          account={account ?? null}
          initialCategory={settingsCategory}
          onClose={() => {
            setSettings(false);
            setSettingsCategory(undefined);
          }}
          onConnect={() => {
            setSettings(false);
            setSignin(true);
          }}
          onDisconnect={async () => {
            await api.disconnect();
            qc.removeQueries({
              predicate: (q) => q.queryKey[0] !== "bootstrap",
            });
            qc.setQueryData(["bootstrap"], { ...boot.data, account: null });
            setSettings(false);
            setLegacy(false);
          }}
        />
      )}
      {signin && (
        <Modal
          title="Gitea account"
          className="project-signin"
          onClose={() => setSignin(false)}
        >
          <SignIn
            onConnected={connected}
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
          onSignIn={() => setSignin(true)}
          onClose={() => setInvitation(undefined)}
          onJoined={async (p, c) => {
            if (c) localStorage.setItem("relay-project-chat:" + p, c.id);
            setSelected(p);
            await chats.refetch();
            if (c) setChatId(c.id);
            setLegacy(false);
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
            setChatId(c.id);
            panes.show("chat");
            setBrowseShared(false);
          }}
        />
      )}
      {share && (
        <ShareConversation
          chat={share}
          project={project!}
          account={account ?? null}
          onClose={() => setShare(undefined)}
          onSignIn={() => setSignin(true)}
          onShared={() => void chats.refetch()}
        />
      )}
    </div>
  );
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
