import { BranchPullRequest } from "./BranchPullRequest";
import type { RelayCommand } from "../../shared/commands";
import { ProjectLocal, ProjectPulls } from "./ProjectViews";
import {
  ShareConversation,
  JoinConversation,
  BrowseShared,
} from "./ProjectSharingDialogs";
import type { LineQuestion } from "../../shared/questions";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderPlus,
  FolderGit2,
  MessageSquare,
  Files,
  Settings2,
  GitPullRequest,
  ChevronDown,
  PanelRight,
  LogIn,
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
import { Settings } from "./Settings";
import { ErrorBox, IconButton, Loading, Modal } from "./ui";
import { ProjectChat } from "./ProjectChat";
import type { ProjectFileLink } from "../lib/project-file-links";
import { ProjectSidebar } from "./ProjectSidebar";
import { RelayMark } from "./RelayMark";
import { PaneResizer } from "./PaneResizer";
import "./projects.css";
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
    [chatId, setChatId] = useState<string | null>(null),
    [mode, setMode] = useState<"changes" | "files" | "pulls">("changes"),
    [pull, setPull] = useState<PullRef | null>(null);
  const [draftScope, setDraftScope] = useState<ChatSummary["scope"]>({
    kind: "project",
  });
  const [openPrRequest, setOpenPrRequest] = useState(0);
  const [choosePR, setChoosePR] = useState(false);
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
    ),
    [chatHidden, setChatHidden] = useState(false),
    [filesHidden, setFilesHidden] = useState(true);
  const [dirty, setDirty] = useState(false),
    [openFileTarget, setOpenFileTarget] = useState<
      (ProjectFileLink & { request: number; projectId: string }) | null
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
      setFilesHidden(true);
      setChatHidden(false);
      try {
        const savedView = JSON.parse(
          localStorage.getItem("relay-project-view:" + project.id) || "null",
        );
        setMode(
          ["changes", "files", "pulls"].includes(savedView?.mode)
            ? savedView.mode
            : "changes",
        );
        setPull(
          savedView?.pull?.owner === project.repository?.owner &&
            savedView?.pull?.name === project.repository?.name &&
            Number.isSafeInteger(savedView?.pull?.number)
            ? savedView.pull
            : null,
        );
      } catch {
        setMode("changes");
        setPull(null);
      }
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
      localStorage.setItem(
        "relay-project-view:" + project.id,
        JSON.stringify({ mode, pull }),
      );
  }, [project?.id, restoredProject, mode, pull]);
  useEffect(() => {
    if (project && project.id === restoredProject)
      localStorage.setItem("relay-project-chat:" + project.id, chatId ?? "");
  }, [project?.id, chatId, restoredProject]);
  useEffect(() => {
    localStorage.setItem("relay-projects-hidden", String(projectsHidden));
    localStorage.setItem("relay-chat-hidden", String(chatHidden));
    localStorage.setItem("relay-code-hidden", String(filesHidden));
  }, [projectsHidden, chatHidden, filesHidden]);
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
      setChatHidden(false);
      return next;
    } catch (e) {
      setError(e);
    }
  }
  async function discuss(ref: PullRef) {
    setPull(ref);
    const existing = chats.data?.find(
      (c) => c.scope.kind === "pr" && c.scope.ref.number === ref.number,
    );
    if (existing) setChatId(existing.id);
    else await newChat({ kind: "pr", ref });
    setChatHidden(false);
  }
  function openCode(next: "changes" | "files" | "pulls") {
    if (dirty && next !== mode) return;
    setMode(next);
    setFilesHidden(false);
    if (next === "pulls" && chat?.scope.kind === "pr") setPull(chat.scope.ref);
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
    setMode("files");
    setFilesHidden(false);
  }
  function navigate(p: Project, next?: ChatSummary, fresh = false) {
    if (dirty) return;
    if (fresh || next)
      localStorage.setItem("relay-project-chat:" + p.id, next?.id ?? "");
    setSelected(p.id);
    if (next || fresh) setChatId(next?.id ?? null);
    setLegacy(false);
    setChatHidden(false);
    setFilesHidden(true);
    setContextText(undefined);
    setViewing({ path: null, viewed: 0, total: 0 });
    if (next?.scope.kind === "pr") {
      setPull(next.scope.ref);
      setMode("pulls");
    }
    if (!next || next.scope.kind !== "pr") {
      setPull(null);
      setMode("changes");
    }
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
      setPull(ref);
      setMode("pulls");
      setFilesHidden(false);
      setChatHidden(false);
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
    else if (command === "new" && project) navigate(project, undefined, true);
    else openCode(command === "files" ? "files" : "changes");
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
  if (boot.error) return <ErrorBox error={boot.error} />;
  if (!boot.data) return <Loading text="Opening your workspace…" />;
  const account = boot.data.account;
  return (
    <div className={`app project-app platform-${boot.data.platform}`}>
      <header className="titlebar project-titlebar">
        <div className="project-titlebar-brand">
          <span className="traffic-space" />
          <button
            type="button"
            className="relay-brand-toggle"
            title="Toggle projects"
            aria-label="Toggle projects"
            aria-pressed={!projectsHidden}
            onClick={() => setProjectsHidden((v) => !v)}
          >
            <RelayMark />
          </button>
          <strong>Relay</strong>
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
            <button
              disabled={dirty && mode !== "changes"}
              onClick={() =>
                openCode(
                  (chat?.scope ?? draftScope).kind === "pr"
                    ? "pulls"
                    : "changes",
                )
              }
            >
              <GitPullRequest size={14} />
              {(chat?.scope ?? draftScope).kind === "pr"
                ? "PR changes"
                : "Changes"}
            </button>
            <button
              disabled={dirty && mode !== "files"}
              onClick={() => openCode("files")}
            >
              <Files size={14} />
              Files
            </button>
            {!filesHidden && (
              <IconButton
                label="Toggle chat"
                active={!chatHidden}
                onClick={() => setChatHidden((v) => !v)}
              >
                <MessageSquare size={16} />
              </IconButton>
            )}
            <IconButton
              label="Toggle code"
              active={!filesHidden}
              disabled={dirty}
              onClick={() => {
                setFilesHidden((v) => !v);
                setChatHidden(false);
                setViewing({ path: null, viewed: 0, total: 0 });
              }}
            >
              <PanelRight size={16} />
            </IconButton>
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
          className="projects-sidebar"
          aria-label="Projects"
          hidden={projectsHidden || legacy}
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
              onSettings={() => setSettings(true)}
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
          <>
            <div className="project-chat-pane" hidden={chatHidden}>
              {!filesHidden && (
                <PaneResizer
                  pane="room"
                  label="Resize project chat"
                  initial={420}
                  min={310}
                  max={750}
                />
              )}
              <ProjectChat
                key={chat?.id ?? `new:${project.id}`}
                project={project}
                onCommand={runCommand}
                projects={projects.data ?? []}
                chat={chat}
                draftScope={draftScope}
                viewing={
                  filesHidden ? { path: null, viewed: 0, total: 0 } : viewing
                }
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
                    setPull(null);
                    setMode("changes");
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
                  setPull(ref);
                  setMode("pulls");
                  setFilesHidden(true);
                  setChatHidden(false);
                }}
                onSwitchProject={(next) => navigate(next, undefined, true)}
                onAddProject={() => void add()}
                canChoosePR={!!account && !!project.repository}
                dirty={dirty}
                onOpenCode={openCode}
                onOpenFile={openChatFile}
              />
            </div>
            {!filesHidden && (
              <main className="project-code-pane">
                <header className="project-code-heading">
                  <div
                    className="project-view-tabs"
                    role="tablist"
                    aria-label="Project view"
                  >
                    {(["changes", "files", "pulls"] as const).map((v) => (
                      <button
                        key={v}
                        role="tab"
                        aria-selected={mode === v}
                        disabled={dirty}
                        className={mode === v ? "selected" : ""}
                        onClick={() => setMode(v)}
                      >
                        {v === "changes"
                          ? "Changes"
                          : v === "files"
                            ? "Files"
                            : "Pull requests"}
                      </button>
                    ))}
                  </div>
                  <span className="spacer" />
                  <IconButton
                    label="Close code panel"
                    disabled={dirty}
                    onClick={() => {
                      setFilesHidden(true);
                      setChatHidden(false);
                      setViewing({ path: null, viewed: 0, total: 0 });
                    }}
                  >
                    <ChevronDown size={16} />
                  </IconButton>
                  <button className="text-button" onClick={() => void linked()}>
                    {project.repository
                      ? `${project.repository.owner}/${project.repository.name}`
                      : "Connect repository"}
                  </button>
                </header>
                {dirty && (
                  <div className="project-buffer-note">
                    Save or close this file before switching projects or views.
                  </div>
                )}
                {mode === "pulls" ? (
                  account && project.repository ? (
                    <ProjectPulls
                      project={project}
                      selected={pull}
                      onSelect={(ref) => void discuss(ref)}
                      disabled={dirty}
                    >
                      {pull && (
                        <div className="project-review">
                          <Connected
                            onDirtyChange={setDirty}
                            key={`${project.id}:${pull.number}`}
                            embedded={{
                              ref: pull,
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
                                    setChatHidden(false);
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
                      )}
                    </ProjectPulls>
                  ) : (
                    <div className="empty">
                      <GitPullRequest size={30} />
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
                  <ProjectLocal
                    key={project.id}
                    project={project}
                    mode={mode}
                    dirty={dirty}
                    onDirtyChange={setDirty}
                    onViewing={setViewing}
                    openTarget={openFileTarget}
                    onOpenTargetConsumed={() => setOpenFileTarget(null)}
                  />
                )}
              </main>
            )}
          </>
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
          onClose={() => setSettings(false)}
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
            setChatHidden(false);
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
            setChatHidden(false);
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
