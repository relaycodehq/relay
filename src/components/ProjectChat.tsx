import { AgentRequestCard } from "./AgentRequestCard";
import type { RelayCommand } from "../../shared/commands";
import { agentMention } from "../../shared/rooms";
import { lineQuestionSchema, type LineQuestion } from "../../shared/questions";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
  CalendarClock,
  RotateCcw,
} from "lucide-react";
import { wakeLabel } from "../../shared/chat-activity";
import { CopyImageMenu } from "./CopyImageMenu";
import {
  applyChatPatch,
  replyRoot,
  type ChatMessage,
  type ChatSummary,
  type Project,
  type ChatScope,
  type ProjectChatSend,
  type ChatImage,
  type AgentProvider,
  type ProjectChat as ProjectChatData,
} from "../../shared/projects";
import { api } from "../lib/api";
import { loadDraftImages, saveDraftImages } from "../lib/draft-images";
import { sendKeyLabel, steerKeyLabel, useSendKey } from "../lib/send-key";
import { ErrorBox, IconButton, Loading, Modal, RichText } from "./ui";
import { LiveSyncControls } from "./LiveSyncControls";
import { ProjectComposer, type ComposerHandle } from "./ProjectComposer";
import {
  AgentSwitchDialog,
  agentName,
  agentSwitchNoticeHidden,
} from "./AgentSwitchDialog";
import { SelectionQuote } from "./SelectionQuote";
import { AgentTurn } from "./AgentTurn";
import { ProviderIcon } from "./ComposerModelPicker";
import { ContextWindowMeter, latestContext } from "./ContextWindowMeter";
import { ProjectPullPicker } from "./ProjectPullPicker";
import { ProjectHeadlinePicker } from "./ProjectHeadlinePicker";
import { WorkItemCards, WorkItemChip } from "./WorkItemCards";
import { workItemMessage, type WorkItem } from "../../shared/devops";
import {
  codeReferenceMessage,
  isCodeReference,
  parseCodeReferences,
  sameCodeReference,
  type CodeReference,
} from "../../shared/code-references";
import { CodeReferenceList } from "./CodeReferenceChip";
import {
  pasteBlock,
  pasteMarkdown,
  pastedTexts,
  replacePastedTexts,
  type PastedText,
} from "../../shared/pasted-texts";
import { PastedTextPill } from "./PastedTextCard";
import { ChangedFilesCard } from "./ChangedFilesCard";
import { StoppedStrip, WaitingStrip } from "./WaitingStrip";
import type { TurnDiffTarget } from "./TurnChanges";
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
    <>
      <div ref={container} className="message-image">
        {source ? (
          <CopyImageMenu source={source}>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={`Open ${image.name}`}
            >
              <img src={source} alt={image.name} loading="lazy" />
            </button>
          </CopyImageMenu>
        ) : (
          <span>
            {error ? "Screenshot unavailable" : "Loading screenshot…"}
          </span>
        )}
      </div>
      {/* Outside .message-image so the thumbnail's button and img rules don't reach the dialog. */}
      {expanded && source && (
        <Modal
          title={image.name}
          onClose={() => setExpanded(false)}
          className="screenshot-dialog"
        >
          <CopyImageMenu source={source} inDialog>
            <img
              className="message-image-expanded"
              src={source}
              alt={image.name}
            />
          </CopyImageMenu>
        </Modal>
      )}
    </>
  );
}
/** One-line divider where another agent took over, with the outgoing agent's note behind it. */
function HandoffRow({
  message: m,
  projectRoot,
  onOpenFile,
}: {
  message: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const [open, setOpen] = useState(false);
  const { from, to } = m.handoff!;
  const switched = `Switched from ${agentName(from)} to ${agentName(to)}`;
  const note = m.status === "complete" && m.body.trim();
  return (
    <div
      className="agent-handoff"
      data-message-id={m.id}
      data-status={m.status}
      role="status"
    >
      <div className="context-compaction">
        <span>
          {m.status === "streaming"
            ? `${agentName(from)} is writing a handoff note for ${agentName(to)}…`
            : note
              ? switched
              : `${switched} · no handoff note`}
        </span>
        {note && (
          <button
            type="button"
            className="text-button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide note" : "Show note"}
          </button>
        )}
      </div>
      {note && open && (
        <div className="agent-handoff-note">
          <RichText
            text={m.body}
            projectRoot={projectRoot}
            onOpenFile={onOpenFile}
          />
        </div>
      )}
    </div>
  );
}
/** A queued message's text, with its attachments counted rather than shown. */
function QueuedBody({ input }: { input: ProjectChatSend }) {
  const pastes = pastedTexts(input.body);
  const body = replacePastedTexts(input.body, () => "\n\n").trim();
  return (
    <>
      <p>{body.replace(/^@(codex|claude)\s+/i, "")}</p>
      {!!input.images?.length && (
        <small>{input.images.length} screenshot(s)</small>
      )}
      {!!pastes.length && <small>{pastes.length} pasted text(s)</small>}
    </>
  );
}
/** A sent message's text, with each paste shown as a pill where it went. */
function UserText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const parts: (string | PastedText)[] = [];
    let last = 0;
    for (const m of text.matchAll(pasteBlock)) {
      parts.push(text.slice(last, m.index));
      parts.push({ n: Number(m[1]), text: m[3] });
      last = m.index! + m[0].length;
    }
    parts.push(text.slice(last));
    return parts;
  }, [text]);
  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          part.trim() ? (
            <RichText key={i} text={part} />
          ) : null
        ) : (
          <p key={i} className="message-paste">
            <PastedTextPill paste={part} />
          </p>
        ),
      )}
    </>
  );
}
/** Drag type for reordering queued messages, so other drops are ignored. */
const QUEUED_DRAG = "application/x-relay-queued-message";
/** Where the reader left each thread they scrolled up in, by the message at
 * the top of the view. Heights above it are estimates after a switch, so a
 * pixel offset would land somewhere else. Threads left at the bottom have no
 * entry and open pinned there. */
const readingPlaces = new Map<string, { id: string; offset: number }>();
const Message = memo(function Message({
  message: m,
  chatId,
  onReply,
  onChanges,
  onTurnDiff,
  onRewind,
  projectRoot,
  onOpenFile,
  replyCount = 0,
}: {
  message: ChatMessage;
  chatId: string;
  onReply: (m: ChatMessage) => void;
  onChanges: () => void;
  onTurnDiff: (m: ChatMessage, path?: string) => void;
  onRewind: (
    m: ChatMessage,
    paths: string[] | null,
    mode: "revert" | "redo",
    force: boolean,
  ) => Promise<{ conflicts: string[] }>;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  replyCount?: number;
}) {
  const parsed = useMemo(() => {
    if (m.role !== "user" || !m.body) return { refs: [], body: m.body };
    const code = parseCodeReferences(m.body);
    return { refs: code.refs, body: code.body };
  }, [m.role, m.body]);
  // A message of only attachments leaves just the agent mention behind.
  const text =
    m.role === "user"
      ? parsed.body?.replace(/^@(codex|claude)\s+/i, "")
      : parsed.body;
  if (m.handoff)
    return (
      <HandoffRow
        message={m}
        projectRoot={projectRoot}
        onOpenFile={onOpenFile}
      />
    );
  if (m.compaction)
    return (
      <div
        className="context-compaction"
        data-message-id={m.id}
        data-status={m.status}
        role="status"
      >
        <span>
          {m.status === "streaming"
            ? "Compacting context…"
            : m.status === "complete"
              ? "Context compacted"
              : m.status === "cancelled"
                ? "Compaction stopped"
                : (m.error ?? "Compaction failed")}
        </span>
      </div>
    );
  return (
    <article
      className={`project-message ${m.role}`}
      data-message-id={m.id}
      aria-label={m.role === "user" ? "Your message" : `${m.provider} answer`}
    >
      <header>
        <strong>
          {m.role === "assistant" && <ProviderIcon provider={m.provider} />}
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
        {m.unprompted && (
          <span
            className="muted"
            title="Claude started this turn itself, for example when a background task finished."
          >
            started on its own
          </span>
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
      {!!parsed.refs.length && (
        <CodeReferenceList
          references={parsed.refs}
          onOpen={(ref) =>
            onOpenFile({ path: ref.path, line: ref.start, directory: false })
          }
        />
      )}
      {text?.trim() ? (
        m.role === "user" ? (
          <UserText text={text} />
        ) : (
          <RichText
            text={text}
            projectRoot={projectRoot}
            onOpenFile={onOpenFile}
          />
        )
      ) : null}
      {!!m.changes?.length && m.status !== "streaming" && (
        <ChangedFilesCard
          files={m.changes}
          onOpen={(path) => onTurnDiff(m, path)}
          onRewind={
            chatId
              ? (paths, mode, force) => onRewind(m, paths, mode, force)
              : undefined
          }
        />
      )}
      {!!m.images?.length && (
        <div className="message-images">
          {m.images?.map((image) => (
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
  onOpenTurnDiff,
  viewing,
}: {
  onCommand: (command: RelayCommand, args: string) => boolean | string;
  project: Project;
  projects: Project[];
  chat?: ChatSummary;
  draftScope: ChatScope;
  contextText?: {
    id: string;
    text: string;
    selection?: LineQuestion;
    code?: CodeReference;
  };
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
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
  viewing: { path: string | null; viewed: number; total: number };
}) {
  const qc = useQueryClient(),
    id = chat?.id ?? `new:${project.id}`,
    scope = chat?.scope ?? draftScope;
  const history = useQuery({
    queryKey: ["project-chat", chat?.id],
    queryFn: async () => {
      // Long threads would otherwise cross IPC whole on every poll; only
      // messages whose version moved come back in full.
      const previous = qc.getQueryData<ProjectChatData>([
        "project-chat",
        chat!.id,
      ]);
      const known = previous
        ? Object.fromEntries(previous.messages.map((m) => [m.id, m.version]))
        : undefined;
      const patch = await (chat!.shared
        ? api.syncProjectChat(chat!.id, known)
        : api.projectChat(chat!.id, known));
      return applyChatPatch(patch, previous);
    },
    enabled: !!chat,
    refetchInterval: (query) =>
      chat?.shared
        ? 2000
        : query.state.data?.queue?.length ||
            query.state.data?.messages.some((m) => m.status === "streaming")
          ? 1000
          : false,
  });
  // Refreshed by the shell's working-tree poll.
  const checkout = useQuery({
    queryKey: ["working-tree", "project", project.id],
    queryFn: () => api.projectWorkingTree(project.id),
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
  const [workItem, setWorkItem] = useState<WorkItem | undefined>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("chat-work-item:" + id) || "null",
      );
      return typeof saved?.id === "number" && typeof saved.title === "string"
        ? saved
        : undefined;
    } catch {
      return undefined;
    }
  });
  const [codeRefs, setCodeRefs] = useState<CodeReference[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("chat-code-refs:" + id) || "[]",
      );
      return Array.isArray(saved) ? saved.filter(isCodeReference) : [];
    } catch {
      return [];
    }
  });
  const created = useRef<ChatSummary | undefined>(undefined);
  const [visible, setVisible] = useState(80);
  const scroll = useRef<HTMLDivElement>(null),
    column = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    returning = useRef<{ id: string; offset: number } | undefined>(undefined);
  const place = `${id}:${rootId ?? ""}`;
  const composer = useRef<ComposerHandle>(null);
  const composerDock = useRef<HTMLDivElement>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [dockHeight, setDockHeight] = useState(0);
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
          if (e.message.status !== "streaming") {
            void qc.invalidateQueries({ queryKey: ["project-chat", chat.id] });
            // What Claude left running rides on the summary.
            void qc.invalidateQueries({ queryKey: ["project-chats"] });
          }
        }
      }),
    [chat?.id, qc],
  );
  useEffect(() => {
    if (selection)
      localStorage.setItem("chat-selection:" + id, JSON.stringify(selection));
    else localStorage.removeItem("chat-selection:" + id);
  }, [id, selection]);
  useEffect(() => {
    if (workItem)
      localStorage.setItem("chat-work-item:" + id, JSON.stringify(workItem));
    else localStorage.removeItem("chat-work-item:" + id);
  }, [id, workItem]);
  useEffect(() => {
    if (codeRefs.length)
      localStorage.setItem("chat-code-refs:" + id, JSON.stringify(codeRefs));
    else localStorage.removeItem("chat-code-refs:" + id);
  }, [id, codeRefs]);
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
  const replyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of parentIds.values())
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, [parentIds]);
  const shown = useMemo(() => {
    const ids = new Set(messages.map((m) => m.id));
    return messages.filter((m) =>
      root
        ? m.id === root.id || parentIds.get(m.id) === root.id
        : !m.parentId || !ids.has(m.parentId),
    );
  }, [messages, parentIds, root]);
  const running = messages.some((m) => m.status === "streaming");
  // Once Claude picks its work back up, its turn shows that instead.
  const pending = !running && chat?.pending?.length ? chat.pending : undefined;
  const stopped = !running && !pending ? chat?.stopped?.items : undefined;
  const sendKey = useSendKey();
  const context = latestContext(shown);
  const compacting = shown.some(
    (m) => m.compaction && m.status === "streaming",
  );
  const [showContext, setShowContext] = useState(0);
  const [agentSwitch, setAgentSwitch] = useState<{
    from: AgentProvider;
    to: AgentProvider;
    resolve: (proceed: boolean) => void;
  }>();
  // Which agent answered last on this branch, and so holds its working context.
  // A side conversation's root belongs to the main session, so it does not count.
  const activeAgent = [...shown]
    .reverse()
    .find(
      (m) =>
        m.role === "assistant" &&
        !m.compaction &&
        !m.handoff &&
        m.id !== root?.id,
    )?.provider;
  function compact(instructions?: string) {
    if (!chat) return;
    setError(undefined);
    void api
      .compactProjectChat(chat.id, root?.id ?? null, instructions)
      .then(() => history.refetch())
      .catch(setError);
  }
  // Session commands need this thread; the rest belong to the workspace.
  function runCommand(command: RelayCommand, args: string): boolean | string {
    if (command === "compact") {
      if (!chat || !context) return "There is no agent session to compact yet.";
      if (running || busy || compacting)
        return "Wait for the current answer before compacting.";
      if (args && context.provider === "codex")
        return "Codex compacts without custom instructions.";
      compact(args || undefined);
      return true;
    }
    if (command === "context") {
      if (!chat || !context)
        return "Context usage appears after the first answer.";
      setShowContext((n) => n + 1);
      return true;
    }
    return onCommand(command, args);
  }
  const draftKey = `chat-draft:${id}${root ? ":" + root.id : ""}`;
  const draft = drafts[draftKey] ?? localStorage.getItem(draftKey) ?? "";
  const onDraft = (v: string, key = draftKey) => {
    localStorage.setItem(key, v);
    setDrafts((s) => ({ ...s, [key]: v }));
  };
  useLayoutEffect(() => {
    if (rootId) localStorage.setItem("chat-reply:" + id, rootId);
    else localStorage.removeItem("chat-reply:" + id);
    returning.current = readingPlaces.get(place);
    follow.current = !returning.current;
    setVisible(80);
  }, [place]);
  useEffect(() => {
    if (contextText) {
      setRootId(null);
      const { code, text } = contextText;
      if (code)
        setCodeRefs((refs) =>
          refs.some((ref) => sameCodeReference(ref, code))
            ? refs
            : [...refs, code],
        );
      else setSelection(contextText.selection);
      if (text) {
        const key = "chat-draft:" + id,
          old = localStorage.getItem(key) || "";
        onDraft(`${old}${old ? "\n\n" : ""}${text}`, key);
      }
      onContextUsed();
    }
  }, [contextText?.id]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const back = returning.current;
    if (back) {
      const top = el.querySelector(
        `[data-message-id="${CSS.escape(back.id)}"]`,
      );
      if (top) {
        el.scrollTop +=
          top.getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          back.offset;
        returning.current = undefined;
        return;
      }
      // Still opening, or that message is gone: then the bottom it is.
      if (!history.data) return;
      returning.current = undefined;
      readingPlaces.delete(place);
      follow.current = true;
    }
    if (follow.current) el.scrollTop = el.scrollHeight;
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
      | "sendAt"
    >,
  ): Promise<boolean> {
    if (busy) return false;
    const to = agentMention(value.body)?.provider;
    if (
      to &&
      activeAgent &&
      to !== activeAgent &&
      !agentSwitchNoticeHidden() &&
      !(await new Promise<boolean>((resolve) =>
        setAgentSwitch({ from: activeAgent, to, resolve }),
      ))
    )
      return false;
    setBusy(true);
    setError(undefined);
    try {
      const target =
        chat ??
        created.current ??
        (await api.createProjectChat(project.id, scope));
      created.current = target;
      const attached = !root && workItem,
        refs = root ? [] : codeRefs;
      const body = attached
        ? workItemMessage(attached, value.body)
        : value.body;
      await api.sendProjectChat(target.id, {
        ...value,
        body: codeReferenceMessage(refs, body),
        id: crypto.randomUUID(),
        ...(root ? { parentId: root.id } : {}),
        ...(viewing.path ? { viewing: viewing.path } : {}),
        ...(!root && selection
          ? { selection: { ...selection, question: value.body } }
          : {}),
      });
      onDraft("");
      setSelection(undefined);
      if (!root) {
        setWorkItem(undefined);
        setCodeRefs([]);
      }
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
      const restoredCode = parent
        ? { refs: [], body: input.body }
        : parseCodeReferences(input.body);
      // Pastes keep their numbers unless the draft already holds some.
      const top = Math.max(0, ...pastedTexts(old).map((p) => p.n));
      const restoredText = top
        ? replacePastedTexts(restoredCode.body, ({ text }, i) =>
            pasteMarkdown({ n: top + i + 1, text }),
          )
        : restoredCode.body;
      const body = [old.trim(), restoredText.trim()]
        .filter(Boolean)
        .join("\n\n");
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
      if (restoredCode.refs.length)
        setCodeRefs((refs) => [
          ...refs,
          ...restoredCode.refs.filter(
            (next) => !refs.some((ref) => sameCodeReference(ref, next)),
          ),
        ]);
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
      void qc.invalidateQueries({ queryKey: ["project-chats", project.id] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function queueAction(
    action: "remove" | "steer" | "move",
    messageId: string,
    index?: number,
  ) {
    if (!chat || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.projectChatQueueAction(chat.id, action, messageId, index);
      await history.refetch();
      void qc.invalidateQueries({ queryKey: ["project-chats", project.id] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const [draggingQueued, setDraggingQueued] = useState<string | null>(null);
  const [queueDrop, setQueueDrop] = useState<{
    id: string;
    where: "before" | "after";
  } | null>(null);
  const clearQueueDrag = () => {
    setDraggingQueued(null);
    setQueueDrop(null);
  };
  function dropQueued() {
    const queue = history.data?.queue,
      moving = draggingQueued,
      target = queueDrop;
    clearQueueDrag();
    if (!chat || !queue || !moving || !target || target.id === moving) return;
    const rest = queue.filter((q) => q.input.id !== moving),
      index =
        rest.findIndex((q) => q.input.id === target.id) +
        (target.where === "after" ? 1 : 0);
    if (queue.findIndex((q) => q.input.id === moving) === index) return;
    // Reorder right away; the refetch after the move confirms it.
    qc.setQueryData<ProjectChatData>(["project-chat", chat.id], (data) =>
      data?.queue
        ? {
            ...data,
            queue: [
              ...rest.slice(0, index),
              queue.find((q) => q.input.id === moving)!,
              ...rest.slice(index),
            ],
          }
        : data,
    );
    void queueAction("move", moving, index);
  }
  // Stable handlers let memoized messages skip re-rendering while typing.
  const latest = useRef({
    messages,
    onOpenCode,
    onOpenFile,
    onOpenTurnDiff,
    chatId: chat?.id,
  });
  latest.current = {
    messages,
    onOpenCode,
    onOpenFile,
    onOpenTurnDiff,
    chatId: chat?.id,
  };
  const openReply = useCallback((m: ChatMessage) => {
    setRootId(replyRoot(latest.current.messages, m.id).id);
  }, []);
  const openChanges = useCallback(
    () => latest.current.onOpenCode("changes"),
    [],
  );
  const openFile = useCallback(
    (target: ProjectFileLink) => latest.current.onOpenFile(target),
    [],
  );
  const openTurnDiff = useCallback((m: ChatMessage, path?: string) => {
    const { chatId, onOpenTurnDiff } = latest.current;
    if (!chatId || !m.changes?.length) return;
    onOpenTurnDiff({
      chatId,
      messageId: m.id,
      files: m.changes,
      path,
      label: `${m.provider === "codex" ? "Codex" : "Claude"} · ${new Date(
        m.created,
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    });
  }, []);
  const rewindTurn = useCallback(
    (
      m: ChatMessage,
      paths: string[] | null,
      mode: "revert" | "redo",
      force: boolean,
    ) => {
      const { chatId } = latest.current;
      if (!chatId) return Promise.resolve({ conflicts: [] });
      return api.rewindProjectTurn(chatId, m.id, paths, mode, force);
    },
    [],
  );
  const isEmpty =
    !messages.length && !history.error && (!chat || !history.isPending);
  useEffect(() => {
    const dock = composerDock.current;
    if (!dock) return;
    // Messages scroll underneath the composer, so they need bottom padding as
    // tall as it. Only measure while expanded: shrinking the padding when the
    // composer collapses would pull the reader back toward the bottom.
    const observer = new ResizeObserver(() => {
      if (dock.classList.contains("collapsed")) return;
      setDockHeight(dock.offsetHeight);
    });
    observer.observe(dock);
    return () => observer.disconnect();
  }, [isEmpty]);
  // The padding lands a render after the measurement, and a thread opens with
  // none, so re-pin once it has. Pinning before it would leave the end of the
  // thread under the composer, and the next scroll event would stop following.
  useLayoutEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [dockHeight]);
  useEffect(() => {
    const content = column.current;
    if (!content) return;
    // Messages grow after they render: off-screen ones swap their estimated
    // height for the real one, and images and code load late. Stay pinned.
    const observer = new ResizeObserver(() => {
      if (follow.current && scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [isEmpty]);
  const peers =
    presence.data?.filter((p) => p.userId !== chat?.shared?.memberId) ?? [];
  return (
    <section
      className={`project-chat ${isEmpty ? "empty-thread" : ""}`}
      aria-label="Project chat"
      style={{ "--composer-dock-height": `${dockHeight}px` } as CSSProperties}
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
            const distance = e.scrollHeight - e.scrollTop - e.clientHeight;
            follow.current = distance < 80;
            setScrolledUp(distance > 160);
            if (returning.current) return;
            if (follow.current) {
              readingPlaces.delete(place);
              return;
            }
            const view = e.getBoundingClientRect().top;
            for (const m of column.current?.querySelectorAll<HTMLElement>(
              "[data-message-id]",
            ) ?? []) {
              const box = m.getBoundingClientRect();
              if (box.bottom <= view) continue;
              readingPlaces.set(place, {
                id: m.dataset.messageId!,
                offset: box.top - view,
              });
              break;
            }
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
          <div className="thread-message-column" ref={column}>
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
                onChanges={openChanges}
                onTurnDiff={openTurnDiff}
                onRewind={rewindTurn}
                projectRoot={project.path}
                onOpenFile={openFile}
                replyCount={root ? 0 : (replyCounts.get(m.id) ?? 0)}
              />
            ))}
            {!running &&
              shown.some(
                (m) => m.role === "assistant" && !m.compaction && !m.handoff,
              ) &&
              ["cancelled", "failed"].includes(
                shown
                  .filter(
                    (m) =>
                      m.role === "assistant" && !m.compaction && !m.handoff,
                  )
                  .at(-1)!.status,
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
                {history.data.queue.map((queued, index, queue) => (
                  <div
                    key={queued.input.id}
                    className={[
                      "queued-message",
                      draggingQueued === queued.input.id && "dragging",
                      queueDrop?.id === queued.input.id &&
                        draggingQueued !== queued.input.id &&
                        `drop-${queueDrop.where}`,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    draggable={queue.length > 1 && !busy}
                    title={queue.length > 1 ? "Drag to reorder" : undefined}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(QUEUED_DRAG, queued.input.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingQueued(queued.input.id);
                    }}
                    onDragEnd={clearQueueDrag}
                    onDragOver={(e) => {
                      if (
                        !draggingQueued ||
                        !e.dataTransfer.types.includes(QUEUED_DRAG)
                      )
                        return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const box = e.currentTarget.getBoundingClientRect(),
                        where =
                          e.clientY < box.top + box.height / 2
                            ? "before"
                            : "after";
                      setQueueDrop((current) =>
                        current?.id === queued.input.id &&
                        current.where === where
                          ? current
                          : { id: queued.input.id, where },
                      );
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropQueued();
                    }}
                  >
                    <QueuedBody input={queued.input} />
                    <footer>
                      <span
                        className="queued-status"
                        title={
                          history.data?.queuePaused
                            ? (queued.error ?? "Waits for Send now")
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
                          aria-label={running ? "Steer now" : "Send now"}
                          title={
                            running
                              ? "Steer the current answer, or send this next when it can't be steered"
                              : "Send now"
                          }
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
                  </div>
                ))}
                {running && (
                  <p className="chat-queue-hint">
                    <kbd>{sendKeyLabel(sendKey)}</kbd> to queue ·{" "}
                    <kbd>{steerKeyLabel(sendKey)}</kbd> to steer
                  </p>
                )}
              </section>
            )}
            {!!history.data?.scheduled?.length && (
              <section className="chat-queue" aria-label="Scheduled messages">
                {[...history.data.scheduled]
                  .sort((a, b) => a.at - b.at)
                  .map((scheduled) => (
                    <div key={scheduled.input.id} className="queued-message">
                      <QueuedBody input={scheduled.input} />
                      <footer>
                        <span
                          className={`queued-status${scheduled.error ? " error" : ""}`}
                          title={
                            scheduled.error ??
                            new Date(scheduled.at).toLocaleString()
                          }
                        >
                          <CalendarClock size={13} />{" "}
                          {scheduled.error
                            ? "Didn't send"
                            : `Sends ${wakeLabel(scheduled.at, new Date())}`}
                        </span>
                        <span className="queued-actions">
                          <button
                            type="button"
                            disabled={busy}
                            aria-label="Send now"
                            title={
                              running
                                ? "Queue now, to send when the current answer finishes"
                                : "Send now"
                            }
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() =>
                              void queueAction("steer", scheduled.input.id)
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
                            onClick={() =>
                              void returnToComposer(scheduled.input)
                            }
                          >
                            <X size={14} />
                          </button>
                        </span>
                      </footer>
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
      <SelectionQuote
        container={scroll}
        onQuote={(text) => composer.current?.insertQuote(text)}
      />
      <div
        ref={composerDock}
        className={
          isEmpty
            ? "thread-start"
            : `thread-bottom-composer${scrolledUp ? " collapsed" : ""}`
        }
      >
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
          handleRef={composer}
          onCommand={runCommand}
          // A side conversation keeps its own agent and opens on the one that wrote its message.
          settingsKey={root ? `${id}:${root.id}` : id}
          inherit={
            root
              ? {
                  settingsKey: id,
                  provider:
                    root.role === "assistant" ? root.provider : undefined,
                }
              : undefined
          }
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
          notice={
            stopped?.length ? (
              <StoppedStrip
                items={stopped}
                onResolve={async (action) => {
                  if (!chat) return;
                  try {
                    await api.resolveStoppedWork(chat.id, action);
                  } catch (e) {
                    setError(e);
                    throw e;
                  } finally {
                    void qc.invalidateQueries({
                      queryKey: ["project-chats"],
                    });
                  }
                }}
              />
            ) : (
              pending && (
                <WaitingStrip
                  pending={pending}
                  onStop={async (item) => {
                    if (!chat) return;
                    try {
                      await api.stopProjectChatPending(chat.id, item.id);
                    } catch (e) {
                      setError(e);
                      throw e;
                    } finally {
                      void qc.invalidateQueries({
                        queryKey: ["project-chats"],
                      });
                    }
                  }}
                />
              )
            )
          }
          placeholder={
            pending?.some((p) => p.kind === "task")
              ? "Message Claude, its background work keeps going…"
              : pending
                ? "Message Claude now, or wait for it to check back…"
                : undefined
          }
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
          contextMeter={
            chat &&
            context && (
              <ContextWindowMeter
                chatId={chat.id}
                usage={context.usage}
                provider={context.provider}
                compacting={compacting}
                compactDisabled={running || busy}
                openSignal={showContext}
                onCompact={() => compact()}
              />
            )
          }
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
          allowEmpty={!root && (!!workItem || !!codeRefs.length)}
          attachment={
            !root && (selection || workItem || codeRefs.length) ? (
              <>
                {!!codeRefs.length && (
                  <CodeReferenceList
                    references={codeRefs}
                    onRemove={(index) =>
                      setCodeRefs((refs) => refs.filter((_, i) => i !== index))
                    }
                  />
                )}
                {workItem && (
                  <WorkItemChip
                    item={workItem}
                    onRemove={() => setWorkItem(undefined)}
                  />
                )}
                {selection && (
                  <div className="composer-reply">
                    <span>
                      {selection.side === "deletions" ? "Before PR" : "PR head"}{" "}
                      · {selection.path}:{selection.start} ·{" "}
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
                )}
              </>
            ) : undefined
          }
        />
        {isEmpty && scope.kind === "project" && !root && (
          <WorkItemCards
            project={project}
            selected={workItem?.id}
            onPick={(item) => {
              setWorkItem(workItem?.id === item.id ? undefined : item);
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLElement>(".thread-start .ProseMirror")
                  ?.focus(),
              );
            }}
          />
        )}
      </div>
      {agentSwitch && (
        <AgentSwitchDialog
          from={agentSwitch.from}
          to={agentSwitch.to}
          onDecide={(proceed) => {
            setAgentSwitch(undefined);
            agentSwitch.resolve(proceed);
          }}
        />
      )}
    </section>
  );
}
