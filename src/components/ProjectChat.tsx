import { AgentRequestCard } from "./AgentRequestCard";
import type { RelayCommand } from "../../shared/commands";
import { agentMention } from "../../shared/rooms";
import { lineQuestionSchema, type LineQuestion } from "../../shared/questions";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LockKeyhole,
  Users,
  Reply,
  X,
  ArrowLeft,
  GitPullRequest,
  FolderGit2,
  ChevronDown,
  ArrowUp,
  Clock3,
  RotateCcw,
} from "lucide-react";
import {
  replyRoot,
  type ChatMessage,
  type ChatSummary,
  type Project,
  type ChatScope,
  type ProjectChatSend,
  type ChatImage,
} from "../../shared/projects";
import { api } from "../lib/api";
import { loadDraftImages, saveDraftImages } from "../lib/draft-images";
import { ErrorBox, IconButton, Loading, Modal, RichText } from "./ui";
import { LiveSyncControls } from "./LiveSyncControls";
import { ProjectComposer } from "./ProjectComposer";
import { AgentTurn } from "./AgentTurn";
import { ProjectPullPicker } from "./ProjectPullPicker";
import { ProjectHeadlinePicker } from "./ProjectHeadlinePicker";
import type { ProjectFileLink } from "../lib/project-file-links";
import type { PullRef } from "../../shared/types";
function MessageImage({ chatId, image }: { chatId: string; image: ChatImage }) {
  const container = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<string>();
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!chatId) return;
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        void api
          .projectChatImage(chatId, image.id)
          .then((url) => {
            if (live) setSource(url);
          })
          .catch(() => {
            if (live) setError(true);
          });
      },
      { rootMargin: "150px" },
    );
    if (container.current) observer.observe(container.current);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [chatId, image.id]);
  return (
    <div ref={container} className="message-image">
      {source ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`Open ${image.name}`}
        >
          <img src={source} alt={image.name} loading="lazy" />
        </button>
      ) : (
        <span>{error ? "Screenshot unavailable" : "Loading screenshot…"}</span>
      )}
      {expanded && source && (
        <Modal
          title={image.name}
          onClose={() => setExpanded(false)}
          className="screenshot-dialog"
        >
          <img
            className="message-image-expanded"
            src={source}
            alt={image.name}
          />
        </Modal>
      )}
    </div>
  );
}
const Message = memo(function Message({
  message: m,
  chatId,
  onReply,
  onChanges,
  projectRoot,
  onOpenFile,
  replyCount = 0,
}: {
  message: ChatMessage;
  chatId: string;
  onReply: (m: ChatMessage) => void;
  onChanges: () => void;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  replyCount?: number;
}) {
  return (
    <article
      className={`project-message ${m.role}`}
      data-message-id={m.id}
      aria-label={m.role === "user" ? "Your message" : `${m.provider} answer`}
    >
      <header>
        <strong>
          {m.role === "user"
            ? (m.author ?? "You")
            : m.provider === "codex"
              ? "Codex"
              : "Claude"}
        </strong>
        <time>
          {new Date(m.created).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        {m.author && m.role === "assistant" && (
          <span className="muted">via {m.author}</span>
        )}
        <button
          className="message-reply"
          aria-label="Reply to message"
          title="Reply to message"
          onClick={() => onReply(m)}
        >
          <Reply size={14} />
        </button>
      </header>
      {m.role === "assistant" && (
        <AgentTurn
          message={m}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
          onChanges={onChanges}
        />
      )}
      {m.body ? (
        <RichText
          text={
            m.role === "user"
              ? m.body.replace(/^@(codex|claude)\s+/i, "")
              : m.body
          }
          projectRoot={m.role === "assistant" ? projectRoot : undefined}
          onOpenFile={m.role === "assistant" ? onOpenFile : undefined}
        />
      ) : null}
      {!!m.images?.length && (
        <div className="message-images">
          {m.images.map((image) => (
            <MessageImage key={image.id} chatId={chatId} image={image} />
          ))}
        </div>
      )}
      {!!replyCount && (
        <button className="thread-replies-link" onClick={() => onReply(m)}>
          <Reply size={13} />
          {replyCount} {replyCount === 1 ? "reply" : "replies"}
        </button>
      )}
      {m.pending && m.status !== "streaming" && (
        <small className="muted">Saved locally · waiting to share</small>
      )}
      {m.status === "cancelled" && (
        <p className="muted" role="status">
          Stopped · partial output kept
        </p>
      )}
      {m.error && m.status !== "cancelled" && (
        <p role="status" className="chat-message-error">
          {m.error}
        </p>
      )}
    </article>
  );
});
export function ProjectChat({
  onCommand,
  project,
  projects,
  chat,
  draftScope,
  contextText,
  onContextUsed,
  onShare,
  onCreated,
  onRepository,
  onChoosePR,
  onSelectPR,
  onSwitchProject,
  onAddProject,
  canChoosePR,
  dirty,
  onOpenCode,
  onOpenFile,
  viewing,
}: {
  onCommand: (command: RelayCommand) => boolean;
  project: Project;
  projects: Project[];
  chat?: ChatSummary;
  draftScope: ChatScope;
  contextText?: { id: string; text: string; selection?: LineQuestion };
  onContextUsed: () => void;
  onShare: () => void;
  onCreated: (c: ChatSummary) => Promise<void>;
  onRepository: () => void;
  onChoosePR: () => void;
  onSelectPR: (ref: PullRef) => void;
  onSwitchProject: (project: Project) => void;
  onAddProject: () => void;
  canChoosePR: boolean;
  dirty: boolean;
  onOpenCode: (mode: "changes" | "files" | "pulls") => void;
  onOpenFile: (target: ProjectFileLink) => void;
  viewing: { path: string | null; viewed: number; total: number };
}) {
  const qc = useQueryClient(),
    id = chat?.id ?? `new:${project.id}`,
    scope = chat?.scope ?? draftScope;
  const history = useQuery({
    queryKey: ["project-chat", chat?.id],
    queryFn: () =>
      chat!.shared ? api.syncProjectChat(chat!.id) : api.projectChat(chat!.id),
    enabled: !!chat,
    refetchInterval: (query) =>
      chat?.shared
        ? 2000
        : query.state.data?.queue?.length ||
            query.state.data?.messages.some((m) => m.status === "streaming")
          ? 1000
          : false,
  });
  const checkout = useQuery({
    queryKey: ["working-tree", "project", project.id],
    queryFn: () => api.projectWorkingTree(project.id),
    refetchInterval: 5000,
  });
  const [updates, setUpdates] = useState<Record<string, ChatMessage>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rootId, setRootId] = useState<string | null>(() =>
    localStorage.getItem("chat-reply:" + id),
  );
  const [composerRevision, setComposerRevision] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const [sharePresence, setSharePresence] = useState(
    () => localStorage.getItem("relay-project-presence") === "true",
  );
  const [sharingOpen, setSharingOpen] = useState(false);
  const [selection, setSelection] = useState<LineQuestion | undefined>(() => {
    try {
      return lineQuestionSchema.safeParse(
        JSON.parse(localStorage.getItem("chat-selection:" + id) || "null"),
      ).data;
    } catch {
      return undefined;
    }
  });
  const created = useRef<ChatSummary | undefined>(undefined);
  const [visible, setVisible] = useState(80);
  const scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const presence = useQuery({
    queryKey: ["chat-presence", chat?.id, sharePresence, viewing],
    queryFn: () =>
      api.projectChatPresence(chat!.id, sharePresence ? viewing : null),
    enabled: !!chat?.shared,
    refetchInterval: 5000,
    retry: false,
  });
  useEffect(
    () => () => {
      if (chat?.shared)
        void api.projectChatPresence(chat.id, null).catch(() => {});
    },
    [chat?.id, chat?.shared?.roomId],
  );
  useEffect(
    () =>
      api.onProjectChat((e) => {
        if (e.chatId === chat?.id) {
          setUpdates((old) => ({ ...old, [e.message.id]: e.message }));
          if (e.message.status !== "streaming")
            void qc.invalidateQueries({ queryKey: ["project-chat", chat.id] });
        }
      }),
    [chat?.id, qc],
  );
  useEffect(() => {
    if (selection)
      localStorage.setItem("chat-selection:" + id, JSON.stringify(selection));
    else localStorage.removeItem("chat-selection:" + id);
  }, [id, selection]);
  const messages = useMemo(() => {
    const byId = new Map((history.data?.messages ?? []).map((m) => [m.id, m]));
    for (const m of Object.values(updates))
      if (!byId.has(m.id) || byId.get(m.id)!.version <= m.version)
        byId.set(m.id, m);
    return [...byId.values()].sort((a, b) =>
      a.seq && b.seq
        ? a.seq - b.seq
        : a.seq
          ? -1
          : b.seq
            ? 1
            : a.created - b.created,
    );
  }, [history.data, updates]);
  const root = messages.find((m) => m.id === rootId);
  const parentIds = useMemo(
    () =>
      new Map(
        messages
          .filter((m) => m.parentId)
          .map((m) => {
            try {
              return [m.id, replyRoot(messages, m.id).id];
            } catch {
              return [m.id, m.parentId];
            }
          }),
      ),
    [messages],
  );
  const shown = messages.filter((m) =>
    root
      ? m.id === root.id || parentIds.get(m.id) === root.id
      : !m.parentId || !messages.some((p) => p.id === m.parentId),
  );
  const running = messages.some((m) => m.status === "streaming");
  const draftKey = `chat-draft:${id}${root ? ":" + root.id : ""}`;
  const draft = drafts[draftKey] ?? localStorage.getItem(draftKey) ?? "";
  const onDraft = (v: string, key = draftKey) => {
    localStorage.setItem(key, v);
    setDrafts((s) => ({ ...s, [key]: v }));
  };
  useEffect(() => {
    if (rootId) localStorage.setItem("chat-reply:" + id, rootId);
    else localStorage.removeItem("chat-reply:" + id);
    follow.current = true;
    setVisible(80);
  }, [rootId, id]);
  useEffect(() => {
    if (contextText) {
      setRootId(null);
      setSelection(contextText.selection);
      const key = "chat-draft:" + id,
        old = localStorage.getItem(key) || "";
      onDraft(`${old}${old ? "\n\n" : ""}${contextText.text}`, key);
      onContextUsed();
    }
  }, [contextText?.id]);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, rootId]);
  async function send(
    value: Pick<
      ProjectChatSend,
      | "body"
      | "provider"
      | "choice"
      | "runtimeMode"
      | "interactionMode"
      | "images"
      | "delivery"
    >,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(undefined);
    try {
      const target =
        chat ??
        created.current ??
        (await api.createProjectChat(project.id, scope));
      created.current = target;
      await api.sendProjectChat(target.id, {
        ...value,
        id: crypto.randomUUID(),
        ...(root ? { parentId: root.id } : {}),
        ...(viewing.path ? { viewing: viewing.path } : {}),
        ...(!root && selection
          ? { selection: { ...selection, question: value.body } }
          : {}),
      });
      onDraft("");
      setSelection(undefined);
      follow.current = true;
      if (!chat) {
        const preferences = localStorage.getItem("composer-settings:" + id);
        if (preferences)
          localStorage.setItem("composer-settings:" + target.id, preferences);
        await onCreated(target);
      } else await history.refetch();
      await qc.invalidateQueries({ queryKey: ["project-chats", project.id] });
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function returnToComposer(input: ProjectChatSend) {
    if (!chat || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const parent = input.parentId
        ? replyRoot(messages, input.parentId).id
        : null;
      const key = `chat-draft:${id}${parent ? ":" + parent : ""}`;
      const old = drafts[key] ?? localStorage.getItem(key) ?? "";
      const body = [old.trim(), input.body].filter(Boolean).join("\n\n");
      if (body.length > 32000)
        throw new Error(
          "Send or shorten the current draft before restoring this message.",
        );
      const existing = await loadDraftImages(key);
      const restored = [
        ...existing,
        ...(input.images ?? []).map((image) => ({
          ...image,
          id: crypto.randomUUID(),
        })),
      ];
      if (restored.length > 3)
        throw new Error(
          "Remove draft screenshots before restoring this message; a message can hold three.",
        );
      if (input.selection && selection)
        throw new Error(
          "Remove the current code selection before restoring this message.",
        );
      // Persist the complete draft before removing the durable queue entry.
      await saveDraftImages(key, restored);
      onDraft(body, key);
      localStorage.setItem(
        "composer-settings:" + id,
        JSON.stringify({
          provider: agentMention(input.body)?.provider ?? "message",
          choice: input.choice,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
        }),
      );
      if (input.selection) {
        localStorage.setItem(
          "chat-selection:" + id,
          JSON.stringify(input.selection),
        );
        setSelection(input.selection);
      }
      setRootId(parent);
      setComposerRevision((value) => value + 1);
      await api.projectChatQueueAction(chat.id, "remove", input.id);
      await history.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function queueAction(action: "remove" | "steer", messageId: string) {
    if (!chat || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.projectChatQueueAction(chat.id, action, messageId);
      await history.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const openReply = (m: ChatMessage) => {
    setRootId(replyRoot(messages, m.id).id);
  };
  const isEmpty =
    !messages.length && !history.error && (!chat || !history.isPending);
  const peers =
    presence.data?.filter((p) => p.userId !== chat?.shared?.memberId) ?? [];
  return (
    <section
      className={`project-chat ${isEmpty ? "empty-thread" : ""}`}
      aria-label="Project chat"
    >
      <div className="thread-subheader">
        {root ? (
          <button className="text-button" onClick={() => setRootId(null)}>
            <ArrowLeft size={14} />
            Back to conversation
          </button>
        ) : (
          <span className="thread-privacy">
            {chat?.shared ? <Users size={13} /> : <LockKeyhole size={13} />}{" "}
            {chat?.shared ? "Shared with your project" : "Private thread"}
          </span>
        )}
        <span className="spacer" />
        {chat?.shared && (
          <button
            className="text-button"
            onClick={() => setSharingOpen((v) => !v)}
            aria-expanded={sharingOpen}
          >
            Together{peers.length ? ` · ${peers.length + 1}` : ""}
          </button>
        )}
        {chat && (
          <button
            className="text-button"
            aria-label="Share conversation"
            onClick={onShare}
            disabled={
              !chat.shared && messages.some((message) => message.images?.length)
            }
            title={
              !chat.shared && messages.some((message) => message.images?.length)
                ? "This conversation contains private screenshots and cannot be shared yet"
                : undefined
            }
          >
            <Users size={14} />
            {chat.shared ? "Invite" : "Share"}
          </button>
        )}
      </div>
      {chat?.shared && sharingOpen && (
        <div className="project-chat-sharing">
          <label>
            <input
              type="checkbox"
              checked={sharePresence}
              onChange={(e) => {
                setSharePresence(e.target.checked);
                localStorage.setItem(
                  "relay-project-presence",
                  String(e.target.checked),
                );
              }}
            />
            Share my location
          </label>
          <LiveSyncControls chatId={chat.id} />
        </div>
      )}
      {chat?.shared &&
        sharingOpen &&
        peers.map((p) => (
          <div className="chat-peer-presence" key={p.userId}>
            {p.name} · {p.path?.split("/").pop() ?? "In conversation"}
            {p.total ? ` · ${p.viewed}/${p.total} viewed` : ""}
          </div>
        ))}
      {!isEmpty && (
        <div
          className="project-messages"
          ref={scroll}
          onScroll={() => {
            const e = scroll.current!;
            follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 80;
          }}
        >
          {chat && history.isPending && (
            <Loading text="Opening conversation…" />
          )}
          {history.error && (
            <ErrorBox
              error={history.error}
              retry={() => void history.refetch()}
            />
          )}
          <div className="thread-message-column">
            {root && <h2 className="reply-heading">Side conversation</h2>}
            {shown.length > visible && (
              <button
                className="load-more"
                onClick={() => setVisible((v) => v + 80)}
              >
                Earlier messages
              </button>
            )}
            {shown.slice(-visible).map((m) => (
              <Message
                key={m.id}
                message={m}
                chatId={chat?.id ?? ""}
                onReply={openReply}
                onChanges={() => onOpenCode("changes")}
                projectRoot={project.path}
                onOpenFile={onOpenFile}
                replyCount={
                  root
                    ? 0
                    : messages.filter((x) => parentIds.get(x.id) === m.id)
                        .length
                }
              />
            ))}
            {!running &&
              shown.some((m) => m.role === "assistant") &&
              ["cancelled", "failed"].includes(
                shown.filter((m) => m.role === "assistant").at(-1)!.status,
              ) &&
              history.data?.lastInput &&
              (history.data.lastInput.parentId ?? null) ===
                (root?.id ?? null) && (
                <button
                  className="resume-answer"
                  disabled={busy}
                  onClick={() => {
                    if (chat) {
                      setBusy(true);
                      void api
                        .resumeProjectChat(chat.id)
                        .then(() => history.refetch())
                        .catch(setError)
                        .finally(() => setBusy(false));
                    }
                  }}
                >
                  <RotateCcw size={13} /> Resume answer
                </button>
              )}
            {!!history.data?.queue?.length && (
              <section className="chat-queue" aria-label="Queued messages">
                {history.data.queue.map((queued, index) => (
                  <div className="queued-message" key={queued.input.id}>
                    <p>
                      {queued.input.body.replace(/^@(codex|claude)\s+/i, "")}
                    </p>
                    {!!queued.input.images?.length && (
                      <small>{queued.input.images.length} screenshot(s)</small>
                    )}
                    <footer>
                      <span
                        className="queued-status"
                        title={
                          history.data?.queuePaused
                            ? "Waits for Send now"
                            : index === 0
                              ? "Sends when the current answer finishes"
                              : "Sends after the messages above it"
                        }
                      >
                        <Clock3 size={13} />{" "}
                        {history.data?.queuePaused ? "Paused" : "Queued"}
                      </span>
                      <span className="queued-actions">
                        <button
                          type="button"
                          disabled={busy}
                          aria-label="Send now"
                          title="Send now"
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={() =>
                            void queueAction("steer", queued.input.id)
                          }
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label="Cancel and return to the composer"
                          title="Cancel and return to the composer"
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={() => void returnToComposer(queued.input)}
                        >
                          <X size={14} />
                        </button>
                      </span>
                    </footer>
                    {queued.error && (
                      <p className="chat-message-error">{queued.error}</p>
                    )}
                  </div>
                ))}
              </section>
            )}
            {root && shown.length === 1 && (
              <p className="thread-reply-empty">
                Dig into this message here. The main conversation stays focused.
              </p>
            )}
          </div>
        </div>
      )}
      <div className={isEmpty ? "thread-start" : "thread-bottom-composer"}>
        {history.data?.requests?.slice(0, 1).map((request) => (
          <AgentRequestCard
            key={request.id}
            request={request}
            pendingCount={history.data?.requests?.length}
            onRespond={async (response) => {
              if (!chat) return;
              await api.respondProjectChat(chat.id, request.id, response);
              await history.refetch();
            }}
          />
        ))}

        {isEmpty && (
          <div className="thread-introduction">
            <h1
              aria-label={
                scope.kind === "pr"
                  ? `Let’s review PR #${scope.ref.number} in ${project.name}.`
                  : `What should we work on in ${project.name}?`
              }
            >
              {scope.kind === "pr" ? (
                <>Let’s review PR #{scope.ref.number} in </>
              ) : (
                <>What should we work on in </>
              )}
              <ProjectHeadlinePicker
                project={project}
                projects={projects}
                disabled={dirty}
                onSelect={onSwitchProject}
                onAdd={onAddProject}
              />
              {scope.kind === "pr" ? "." : "?"}
            </h1>
            <p>
              {scope.kind === "pr"
                ? "Ask about the changes. Open the review when you’re ready."
                : "Understand the code, work on an idea, or review your changes."}
            </p>
          </div>
        )}
        {!!error && <ErrorBox error={error} />}
        <ProjectComposer
          key={`${id}:${root?.id ?? "main"}:${composerRevision}`}
          onCommand={onCommand}
          settingsKey={id}
          draftKey={draftKey}
          draft={draft}
          onDraft={onDraft}
          shared={!!chat?.shared}
          running={running}
          busy={busy}
          branch={checkout.data?.branch}
          projectId={project.id}
          checkoutDisabled={dirty}
          onSend={send}
          planProvider={
            !running &&
            shown.at(-1)?.status === "complete" &&
            shown.at(-1)?.proposedPlan
              ? shown.at(-1)?.provider
              : undefined
          }
          onStop={() => {
            if (chat) void api.cancelProjectChat(chat.id).catch(setError);
          }}
          context={
            <>
              <button
                className={`thread-context-button ${scope.kind === "project" ? "selected" : ""}`}
                onClick={onRepository}
              >
                <FolderGit2 size={14} />
                Repository
              </button>
              {canChoosePR ? (
                <ProjectPullPicker
                  project={project}
                  selected={scope.kind === "pr" ? scope.ref : null}
                  onSelect={onSelectPR}
                  disabled={dirty}
                  compact
                />
              ) : (
                <button
                  className={`thread-context-button ${scope.kind === "pr" ? "selected" : ""}`}
                  onClick={onChoosePR}
                  disabled={dirty}
                >
                  <GitPullRequest size={14} />
                  {scope.kind === "pr"
                    ? `PR #${scope.ref.number}`
                    : "Review a PR"}
                  <ChevronDown size={12} />
                </button>
              )}
              {scope.kind === "pr" && (
                <button
                  className="thread-review-action"
                  onClick={() => onOpenCode("pulls")}
                >
                  Review changes →
                </button>
              )}
            </>
          }
          attachment={
            !root && selection ? (
              <div className="composer-reply">
                <span>
                  {selection.side === "deletions" ? "Before PR" : "PR head"} ·{" "}
                  {selection.path}:{selection.start} ·{" "}
                  {(selection.side === "deletions"
                    ? selection.base
                    : selection.head
                  ).slice(0, 8)}
                </span>
                <IconButton
                  label="Remove selected code"
                  onClick={() => setSelection(undefined)}
                >
                  <X size={13} />
                </IconButton>
              </div>
            ) : undefined
          }
        />
      </div>
    </section>
  );
}
