import { BranchPullRequest } from "./BranchPullRequest";
import type { RelayCommand } from "../../shared/commands";
import { ProjectChanges, ProjectFiles, type FileTarget } from "./ProjectViews";
import {
  NO_SLOTS,
  Pane,
  PaneHeader,
  PaneToggles,
  type PaneSlots,
} from "./WorkspacePanes";
import { useWorkspacePanes, type PaneId } from "../lib/workspace-panes";
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
} from "lucide-react";
import { parseRoomInvitation } from "../../shared/rooms";
import type { Account, PullRef } from "../../shared/types";
import {
  chatScopeSchema,
  type Project,
  type ChatSummary,
} from "../../shared/projects";
import { api } from "../lib/api";
import { Connected, SignIn } from "../ReviewSurface";
import { Settings, type SettingsCategory } from "./Settings";
import { ErrorBox, IconButton, Loading, Modal } from "./ui";
import { ProjectChat } from "./ProjectChat";
import type { CodeReference } from "../../shared/code-references";
import type { ProjectFileLink } from "../lib/project-file-links";
import { ProjectSidebar } from "./ProjectSidebar";
import { RelayMark } from "./RelayMark";
import { PaneResizer } from "./PaneResizer";
import { ProjectChecksButton } from "./ProjectChecks";
import { useProjectChecks } from "../lib/useProjectChecks";
import "./projects.css";
const NO_VIEWING = { path: null, viewed: 0, total: 0 };
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
  const panes = useWorkspacePanes();
  const [changesSlots, setChangesSlots] = useState<PaneSlots>(NO_SLOTS);
  const [dirty, setDirty] = useState(false),
    [openFileTarget, setOpenFileTarget] = useState<FileTarget | null>(null),
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
    projects.data?.find((p) => p.id === selected) ?? projects.data?.[0];
  const chats = useQuery({
    queryKey: ["project-chats", project?.id],
    queryFn: () => api.projectChats(project!.id),
    enabled: !!project,
  });
  const chat = chats.data?.find((c) => c.id === chatId);
  // A PR thread reviews its PR; any other thread shows the working tree.
  const scope = chat?.scope ?? draftScope;
  const pull = scope.kind === "pr" ? scope.ref : null;
  const codeOpen = panes.layout.open.changes || panes.layout.open.files;
  // The one poller for the working tree: panes, pickers and the chat read this
  // cache. Every polling observer would run its own round of Git commands.
  const tree = useQuery({
    queryKey: ["working-tree", "project", project?.id],
    queryFn: () => api.projectWorkingTree(project!.id),
    enabled: !!project && !legacy,
    refetchInterval: 3000,
  });
  // Live checks for the working tree. A PR thread's review runs its own checks
  // (one session at a time), so the working-tree checks stand aside there.
  const checks = useProjectChecks(
    undefined,
    project && tree.data && !legacy && !pull
      ? { id: project.id, head: tree.data.head }
      : undefined,
    // An agent rewriting files would trigger a recheck on every save.
    !!chats.data?.some((c) => c.running),
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
  useEffect(() => {
    localStorage.setItem("relay-projects-hidden", String(projectsHidden));
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
        !settings &&
        !signin &&
        !choosePR &&
        !share &&
        !invitation &&
        !browseShared &&
        !error &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        navigate(project, undefined, true);
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    project?.id,
    chatId,
    legacy,
    dirty,
    settings,
    signin,
    choosePR,
    share,
    invitation,
    browseShared,
    error,
  ]);
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
  function openCode(next: "changes" | "files" | "pulls") {
    panes.show(next === "files" ? "files" : "changes");
  }
  function togglePane(id: PaneId) {
    const open = panes.layout.open[id];
    if (open && id === "files" && dirty) return;
    panes.setOpen(id, !open);
    if (open && id !== "chat") setViewing(NO_VIEWING);
  }
  function openChatFile(target: ProjectFileLink) {
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
  function navigate(p: Project, next?: ChatSummary, fresh = false) {
    if (dirty) return;
    if (fresh || next)
      localStorage.setItem("relay-project-chat:" + p.id, next?.id ?? "");
    setSelected(p.id);
    if (next || fresh) setChatId(next?.id ?? null);
    setLegacy(false);
    panes.closeCode();
    setContextText(undefined);
    setViewing(NO_VIEWING);
    if (fresh) setDraftScope({ kind: "project" });
  }
  async function reviewBranchPr(ref: PullRef) {
    if (!project || dirty) return;
    try {
      const scope = { kind: "pr" as const, ref };
      const target =
        chat && !chat.shared
          ? await api.setProjectChatScope(chat.id, scope)
          : await api.createProjectChat(project.id, scope);
      await chats.refetch();
      await qc.invalidateQueries({ queryKey: ["project-chat", target.id] });
      setChatId(target.id);
      setDraftScope(scope);
      panes.show("changes");
      panes.show("chat");
    } catch (e) {
      setError(e);
    }
  }
  function runCommand(command: RelayCommand) {
    if (dirty) {
      setError(new Error("Save or close your edited file first."));
      return false;
    }
    if (command === "openpr") setOpenPrRequest((n) => n + 1);
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
              setProjectsHidden((v) => !v);
            }}
            onMouseEnter={peekOpen}
            onMouseLeave={peekClose}
          >
            <RelayMark />
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
            <FolderGit2 size={14} />
            <span>{project?.name ?? "Workspace"}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{chat?.title ?? "New thread"}</strong>
          </div>
        )}
        <span className="spacer" />
        {!legacy && project && (
          <div className="thread-header-actions">
            <ProjectChecksButton
              quiet
              checks={checks}
              onOpenFile={(path, line) =>
                openChatFile({ path, line, directory: false })
              }
            />
            <BranchPullRequest
              key={project.id}
              project={project}
              connected={!!account}
              disabled={dirty}
              request={openPrRequest}
              onConnect={() => setSignin(true)}
              onReview={(ref) => void reviewBranchPr(ref)}
              onChanges={() => openCode("changes")}
            />
            <PaneToggles
              onToggle={togglePane}
              onMove={panes.move}
              panes={panes.layout.order.map((id) => ({
                id,
                open: panes.layout.open[id],
                disabled:
                  (id === "files" && dirty && panes.layout.open.files) ||
                  (panes.layout.open[id] && panes.visible.length === 1),
                ...(id === "chat"
                  ? { label: "Chat", icon: <MessageSquare size={14} /> }
                  : id === "files"
                    ? { label: "Files", icon: <Files size={14} /> }
                    : pull
                      ? {
                          label: `PR #${pull.number}`,
                          icon: <GitPullRequest size={14} />,
                        }
                      : {
                          label: "Changes",
                          icon: <GitCompareArrows size={14} />,
                        }),
              }))}
            />
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
            onProject={(p) => navigate(p)}
            onChat={(c) => {
              const p = projects.data?.find((p) => p.id === c.projectId);
              if (p) navigate(p, c);
            }}
            onNew={(p) => navigate(p, undefined, true)}
            onAdd={() => void add()}
            onShared={(p) => {
              navigate(p);
              setBrowseShared(true);
            }}
            onSettings={() => setSettings(true)}
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
              Open a local Git folder to edit, review changes and chat with your
              agent.
              <br />
              Connect Gitea when you’re ready to review pull requests together.
            </p>
            <button className="primary" onClick={() => void add()}>
              <FolderPlus size={16} />
              Add project folder
            </button>
          </main>
        ) : (
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
                projects={projects.data ?? []}
                chat={chat}
                draftScope={draftScope}
                viewing={codeOpen ? viewing : NO_VIEWING}
                contextText={contextText}
                onContextUsed={() => setContextText(undefined)}
                onShare={() => {
                  if (chat) setShare(chat);
                }}
                onCreated={async (c) => {
                  await chats.refetch();
                  setChatId(c.id);
                }}
                onRepository={() => {
                  if (dirty) return;
                  if (!chat) {
                    setDraftScope({ kind: "project" });
                    return;
                  }
                  if (chat.scope.kind === "pr")
                    navigate(project, undefined, true);
                }}
                onChoosePR={() => {
                  if (!dirty) setChoosePR(true);
                }}
                onSelectPR={(ref) => {
                  setChatId(null);
                  setDraftScope({ kind: "pr", ref });
                }}
                onSwitchProject={(next) => navigate(next, undefined, true)}
                onAddProject={() => void add()}
                canChoosePR={!!account && !!project.repository}
                dirty={dirty}
                onOpenCode={openCode}
                onOpenFile={openChatFile}
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
                            slots: changesSlots,
                            onEditFile: (path, line) =>
                              openChatFile({ path, line, directory: false }),
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
                                    text: `@codex About ${target.path}:${target.start}${target.end !== target.start ? `–${target.end}` : ""} (${target.side === "deletions" ? "before PR" : "PR head"})\n\n`,
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
                      key={project.id}
                      project={project}
                      slots={changesSlots}
                      onViewing={setViewing}
                      onOpenFile={(path) =>
                        openChatFile({ path, directory: false })
                      }
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
                    closeDisabled={dirty}
                    onClose={() => togglePane("files")}
                  />
                  <ProjectFiles
                    key={project.id}
                    project={project}
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
