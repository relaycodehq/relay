import { AgentRequestCard } from "./AgentRequestCard";
import type { RelayCommand } from "../../shared/commands";
import { agentMention } from "../../shared/rooms";
import { lineQuestionSchema, type LineQuestion } from "../../shared/questions";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
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
  ScanSearch,
} from "lucide-react";
import { wakeLabel } from "../../shared/chat-activity";
import {
  applyChatPatch,
  replyRoot,
  type ChatMessage,
  type ChatSummary,
  type Project,
  type ChatScope,
  type ChatWorkspace,
  type ProjectChatSend,
  type ChatImage,
  type AgentProvider,
  type ProjectChat as ProjectChatData,
  turnImages,
} from "../../shared/projects";
import { api } from "../lib/api";
import { loadDraftImages, saveDraftImages } from "../lib/draft-images";
import { readDraft, writeDraft } from "../lib/drafts";
import {
  resetComposerModels,
  saveSentSettings,
} from "../lib/composer-settings";
import { sendKeyLabel, steerKeyLabel, useSendKey } from "../lib/send-key";
import { ErrorBox, IconButton, Loading, RichText } from "./ui";
import {
  ImageThumbnail,
  useWorkingImages,
  type PreviewImage,
} from "./ImagePreview";
import { ImageViewer } from "./ImageViewer";
import { LiveSyncControls } from "./LiveSyncControls";
import { ProjectComposer, type ComposerHandle } from "./ProjectComposer";
import {
  AgentSwitchDialog,
  agentName,
  agentSwitchNoticeHidden,
} from "./AgentSwitchDialog";
import { SelectionQuote } from "./SelectionQuote";
import { AgentTurn } from "./AgentTurn";
import { MessageActions } from "./MessageActions";
import { ProviderIcon } from "./ComposerModelPicker";
import { SideQuestion, type SideThread } from "./SideQuestion";
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
  pastedTexts,
  pastesAfter,
  replacePastedTexts,
  type PastedText,
} from "../../shared/pasted-texts";
import { PastedTextPill } from "./PastedTextCard";
import { ChangedFilesCard } from "./ChangedFilesCard";
import { StoppedStrip, WaitingStrip } from "./WaitingStrip";
import {
  CheckoutControl,
  RemoveWorktreeDialog,
  WorkspacePicker,
  WorktreeLanded,
  WorktreeMenu,
} from "./WorktreeControls";
import type { TurnDiffTarget } from "./TurnChanges";
import { matchLink, type ProjectFileLink } from "../lib/project-file-links";
import type { PullRef } from "../../shared/types";
import {
  fixRequest,
  type DeepReviewStart,
  type Finding,
} from "../../shared/deep-review";
import {
  DeepReviewCouncil,
  DeepReviewReport,
  DeepReviewRequest,
  DeepReviewSetup,
  findingCode,
} from "./DeepReview";
import { UltraplanCouncil } from "./Ultraplan";
import { councilWorking } from "../../shared/ultraplan";
function userImage(chatId: string, image: ChatImage): PreviewImage {
  return {
    key: `${chatId}:${image.id}`,
    name: image.name,
    load: () => api.projectChatImage(chatId, image.id),
  };
}
/** An image file the agent read in the turn `messageId`, as it is on disk now. */
function readImage(
  chatId: string,
  messageId: string,
  path: string,
  projectRoot: string,
): PreviewImage {
  return {
    key: `${chatId}:${messageId}:${path}`,
    name: path.split("/").at(-1) || path,
    path,
    location: path.startsWith(`${projectRoot}/`)
      ? path.slice(projectRoot.length + 1)
      : path,
    load: () => api.projectChatReadImage(chatId, messageId, path),
    reveal: () => api.revealProjectChatReadImage(chatId, messageId, path),
  };
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
  const code = parseCodeReferences(input.body);
  const pastes = pastedTexts(code.body);
  const body = replacePastedTexts(code.body, () => "\n\n").trim();
  return (
    <>
      <p>{body.replace(/^@(codex|claude)\s+/i, "")}</p>
      {!!code.refs.length && (
        <small>{code.refs.length} code reference(s)</small>
      )}
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
/** The message at the top of the thread's view, and how far below it starts. */
function placeInView(view: HTMLElement) {
  const top = view.getBoundingClientRect().top;
  for (const m of view.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const box = m.getBoundingClientRect();
    if (box.bottom > top)
      return { id: m.dataset.messageId!, offset: box.top - top };
  }
}
/** Scrolls a message back to its place in the view; false if it isn't shown. */
function scrollToPlace(
  view: HTMLElement,
  { id, offset }: { id: string; offset: number },
) {
  const message = view.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  if (!message) return false;
  view.scrollTop +=
    message.getBoundingClientRect().top -
    view.getBoundingClientRect().top -
    offset;
  return true;
}
const Message = memo(function Message({
  message: m,
  chatId,
  onReply,
  onFork,
  onChanges,
  onTurnDiff,
  onRewind,
  projectRoot,
  onOpenFile,
  replyCount = 0,
  inlineCode,
  after,
}: {
  message: ChatMessage;
  chatId: string;
  onReply: (m: ChatMessage) => void;
  /** Absent where a thread can't be forked, like a deep review. */
  onFork?: (m: ChatMessage) => void;
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
  /** See RichText; the lead's summary shows findings this way. */
  inlineCode?: (value: string) => ReactNode | undefined;
  /** Shown below the answer, like a deep review's findings. */
  after?: ReactNode;
}) {
  /** The key of the image open in the viewer. */
  const [viewing, setViewing] = useState<string>();
  const allImages = useMemo(
    () =>
      chatId
        ? [
            ...(m.images ?? []).map((image) => userImage(chatId, image)),
            ...turnImages(m).map((path) =>
              readImage(chatId, m.id, path, projectRoot),
            ),
          ]
        : [],
    [chatId, m, projectRoot],
  );
  const images = useWorkingImages(allImages, viewing);
  const viewingIndex = images.findIndex((image) => image.key === viewing);
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
        {m.role === "user" && (
          <time>
            {new Date(m.created).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        )}
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
      </header>
      {m.role === "assistant" && (
        <AgentTurn
          message={m}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
          onChanges={onChanges}
          onOpenImage={
            chatId
              ? (path) => {
                  const image = allImages.find((i) => i.path === path);
                  if (image) setViewing(image.key);
                }
              : undefined
          }
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
            inlineCode={inlineCode}
          />
        )
      ) : null}
      {after}
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
      {/* The images the agent read show once its turn ends, after the answer. */}
      {!!images.length && m.status !== "streaming" && (
        <div className="message-images">
          {images.map((image) => (
            <ImageThumbnail
              key={image.key}
              image={image}
              onOpen={() => setViewing(image.key)}
            />
          ))}
        </div>
      )}
      {viewingIndex >= 0 && (
        <ImageViewer
          images={images}
          index={viewingIndex}
          onIndex={(index) => setViewing(images[index].key)}
          onClose={() => setViewing(undefined)}
        />
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
      {m.role === "assistant" && (
        <MessageActions
          text={text}
          sent={m.created}
          pending={m.status === "streaming"}
          onReply={() => onReply(m)}
          onFork={onFork && (() => onFork(m))}
        />
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
  onDeepReview,
  onSwitchProject,
  onAddProject,
  canChoosePR,
  dirty,
  onOpenCode,
  onOpenFile,
  onOpenTurnDiff,
  onDraftWorkspace,
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
  onDeepReview: () => void;
  onSwitchProject: (project: Project) => void;
  onAddProject: () => void;
  canChoosePR: boolean;
  dirty: boolean;
  onOpenCode: (mode: "changes" | "files" | "pulls") => void;
  onOpenFile: (target: ProjectFileLink) => void;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
  /** Where the unsent thread will work, as the picker changes. */
  onDraftWorkspace?: (workspace: ChatWorkspace) => void;
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
    enabled: !project.plain,
  });
  const [updates, setUpdates] = useState<Record<string, ChatMessage>>({});
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
    returning = useRef<{ id: string; offset: number } | undefined>(undefined),
    // Where holding that message left the scroll; a scroll elsewhere is the reader's.
    placed = useRef(0),
    oldest = useRef<string | undefined>(undefined);
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
  // The bar under each side question: how many replies, when the last came.
  const sideThreads = useMemo(() => {
    const threads = new Map<string, SideThread>();
    for (const m of messages)
      if (m.side)
        threads.set(m.id, { replies: 0, last: m.created, answering: false });
    for (const m of messages) {
      const thread = threads.get(parentIds.get(m.id) ?? "");
      if (!thread) continue;
      if (m.status === "streaming") thread.answering = true;
      else {
        thread.replies++;
        thread.last = Math.max(thread.last, m.ended ?? m.created);
      }
    }
    return threads;
  }, [messages, parentIds]);
  const shown = useMemo(() => {
    const ids = new Set(messages.map((m) => m.id));
    return messages.filter((m) =>
      root
        ? m.id === root.id || parentIds.get(m.id) === root.id
        : !m.parentId || !ids.has(m.parentId),
    );
  }, [messages, parentIds, root]);
  const running = messages.some((m) => m.status === "streaming");
  // Where a new thread will work; a started one keeps its own.
  const [workspace, setWorkspace] = useState<ChatWorkspace>("checkout");
  useEffect(() => {
    if (!chat) onDraftWorkspace?.(workspace);
  }, [workspace, !chat]);
  const worktree = useQuery({
    queryKey: ["worktree", chat?.id],
    queryFn: () => api.projectWorktree(chat!.id),
    enabled: !!chat?.worktree,
    refetchInterval: 5000,
  });
  // Where this thread's files are: links in its answers resolve against it.
  const folder =
    worktree.data?.path && !worktree.data.removed
      ? worktree.data.path
      : project.path;
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [removingWorktree, setRemovingWorktree] = useState(false);
  useEffect(() => {
    // A finished turn leaves new changes to count.
    if (!running && chat?.worktree) void worktree.refetch();
  }, [running]);
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
  const review = history.data?.deepReview;
  // Reviewers work in threads of their own; this one waits for the lead.
  const reviewing = review?.status === "reviewing";
  const plans = history.data?.ultraplans;
  // Thinkers work in threads of their own; messages wait for the lead's plan.
  const planning = councilWorking(Object.values(plans ?? {}));
  // A council's brief shows inside it, not as an answer of its own.
  const listed = useMemo(() => shown.filter((m) => !m.brief), [shown]);
  const leadAnswered = messages.some(
    (m) => m.role === "assistant" && !m.parentId,
  );
  // Keyed on the report alone: a new renderer redraws the whole summary, and
  // the review changes with every finding dismissed or fixed.
  const reviewCode = useMemo(
    () =>
      chat && review?.report
        ? findingCode(chat.id, review.report.findings)
        : undefined,
    [chat?.id, review?.report],
  );
  // A start that failed leaves its thread for the next try. Kept apart from
  // `created`, so a message sent from this draft instead gets a thread of its own.
  const reviewThread = useRef<ChatSummary | undefined>(undefined);
  async function startReview(config: DeepReviewStart) {
    if (busy) return false;
    setBusy(true);
    setError(undefined);
    try {
      const target =
        reviewThread.current ??
        (await api.createProjectChat(project.id, { kind: "review" }));
      reviewThread.current = target;
      // Messages in the thread go to the lead, with the lead's settings.
      const { lead } = config;
      saveSentSettings(target.id, lead.provider, {
        ...lead,
        runtimeMode: config.runtimeMode,
        interactionMode: "default",
      });
      await api.startDeepReview(target.id, config);
      follow.current = true;
      await onCreated(target);
      await qc.invalidateQueries({ queryKey: ["project-chats", project.id] });
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  // Straight to the lead; whatever the composer holds stays there.
  async function fixFindings(findings: Finding[]) {
    if (!chat || !review || !findings.length || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.sendProjectChat(chat.id, {
        id: crypto.randomUUID(),
        body: fixRequest(review.lead.provider, findings),
        provider: review.lead.provider,
        choice: review.lead.choice,
        runtimeMode: review.runtimeMode,
        interactionMode: "default",
        fixes: findings.map((f) => f.id),
      });
      follow.current = true;
      await history.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function setFindingStatus(id: string, status: "open" | "dismissed") {
    if (!chat) return;
    void api
      .setDeepReviewFinding(chat.id, id, status)
      .then(() => history.refetch())
      .catch(setError);
  }
  function resumeReview() {
    if (!chat || busy) return;
    setBusy(true);
    setError(undefined);
    void api
      .resumeDeepReview(chat.id)
      .then(() => history.refetch())
      .catch(setError)
      .finally(() => setBusy(false));
  }
  function resumeUltraplan(request: string) {
    if (!chat || busy) return;
    setBusy(true);
    setError(undefined);
    void api
      .resumeUltraplan(chat.id, request)
      .then(() => history.refetch())
      .catch(setError)
      .finally(() => setBusy(false));
  }
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
    // With a question and an agent picked, the composer sends it itself.
    if (command === "btw")
      return args
        ? "Pick Claude or Codex to ask a side question."
        : "Type your question after /btw.";
    if (command === "context") {
      if (!chat || !context)
        return "Context usage appears after the first answer.";
      setShowContext((n) => n + 1);
      return true;
    }
    return onCommand(command, args);
  }
  const draftKey = `chat-draft:${id}${root ? ":" + root.id : ""}`;
  const onDraft = (v: string, key = draftKey) => writeDraft(key, v);
  useLayoutEffect(() => {
    if (rootId) localStorage.setItem("chat-reply:" + id, rootId);
    else localStorage.removeItem("chat-reply:" + id);
    returning.current = readingPlaces.get(place);
    follow.current = !returning.current;
    oldest.current = undefined;
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
          old = readDraft(key);
        onDraft(`${old}${old ? "\n\n" : ""}${text}`, key);
      }
      onContextUsed();
    }
  }, [contextText?.id]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const back = returning.current;
    // Sending a message pins the thread instead.
    if (back && !follow.current) {
      // Held there until the reader scrolls; see the observer below.
      if (scrollToPlace(el, back)) {
        placed.current = el.scrollTop;
        return;
      }
      // Further back than the latest messages: show enough to reach it.
      const index = shown.findIndex((m) => m.id === back.id);
      if (index >= 0) {
        setVisible(shown.length - index);
        return;
      }
      // Still opening, or that message is gone: then the bottom it is.
      if (!history.data) return;
      readingPlaces.delete(place);
      follow.current = true;
    }
    returning.current = undefined;
    if (follow.current) el.scrollTop = el.scrollHeight;
  }, [messages, rootId, visible]);
  // Up the thread, new messages would push the oldest ones shown out from
  // under the reader: keep showing from the same message until they follow.
  useLayoutEffect(() => {
    const index = shown.findIndex((m) => m.id === oldest.current);
    if (!follow.current && index >= 0 && shown.length - index > visible) {
      setVisible(shown.length - index);
      return;
    }
    oldest.current = shown[Math.max(0, shown.length - visible)]?.id;
  }, [shown, visible]);
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
      | "side"
      | "ultraplan"
    >,
  ): Promise<boolean> {
    if (busy) return false;
    if (value.side) return askAside(value);
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
        (await api.createProjectChat(
          project.id,
          scope,
          scope.kind === "project" ? workspace : undefined,
        ));
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
      // A side conversation leaves the thread's attachments waiting.
      if (!root) {
        setSelection(undefined);
        setWorkItem(undefined);
        setCodeRefs([]);
      }
      follow.current = true;
      if (!chat) {
        const preferences = localStorage.getItem("composer-settings:" + id);
        if (preferences)
          localStorage.setItem("composer-settings:" + target.id, preferences);
        resetComposerModels(id);
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
  /** `/btw`: its thread opens, and the main thread's draft and attachments wait. */
  async function askAside(
    value: Pick<
      ProjectChatSend,
      "body" | "provider" | "choice" | "runtimeMode" | "interactionMode"
    >,
  ) {
    if (!chat) {
      setError(
        new Error("Ask the agent something first, then ask on the side."),
      );
      return false;
    }
    setBusy(true);
    setError(undefined);
    try {
      const question = crypto.randomUUID();
      await api.sendProjectChat(chat.id, {
        ...value,
        id: question,
        side: true,
      });
      onDraft("");
      await history.refetch();
      setRootId(question);
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
      const old = readDraft(key);
      const restoredCode = parent
        ? { refs: [], body: input.body }
        : parseCodeReferences(input.body);
      const restoredText = pastesAfter(old, restoredCode.body);
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
      // A reply goes back to its side conversation, which keeps its own settings.
      saveSentSettings(
        parent ? `${id}:${parent}` : id,
        agentMention(input.body)?.provider ?? "message",
        input,
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
    onCreated,
    chatId: chat?.id,
    worktree: worktree.data,
  });
  latest.current = {
    messages,
    onOpenCode,
    onOpenFile,
    onOpenTurnDiff,
    onCreated,
    chatId: chat?.id,
    worktree: worktree.data,
  };
  const openReply = useCallback((m: ChatMessage) => {
    setRootId(replyRoot(latest.current.messages, m.id).id);
  }, []);
  const forkThread = useCallback(async (m: ChatMessage) => {
    const { chatId, onCreated } = latest.current;
    if (!chatId) return;
    setError(undefined);
    try {
      await onCreated(await api.forkProjectChat(chatId, m.id));
    } catch (e) {
      setError(e);
    }
  }, []);
  const openChanges = useCallback(
    () => latest.current.onOpenCode("changes"),
    [],
  );
  const openFile = useCallback((target: ProjectFileLink) => {
    const { chatId, worktree, onOpenFile, onOpenTurnDiff } = latest.current;
    // A file the worktree changed opens on its worktree diff; the checkout has the old one.
    const matches = worktree
      ? matchLink(
          target,
          worktree.files.map((f) => f.path),
        )
      : [];
    const changed =
      target.directory || matches.length === 1 ? matches[0] : undefined;
    if (chatId && worktree && changed)
      onOpenTurnDiff({
        chatId,
        messageId: "worktree",
        files: worktree.files,
        path: changed,
        label: worktree.branch ?? "Worktree",
        worktree: true,
      });
    else onOpenFile(target);
  }, []);
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
  async function worktreeAction(action: (chatId: string) => Promise<void>) {
    if (!chat || worktreeBusy) return;
    setWorktreeBusy(true);
    setError(undefined);
    try {
      await action(chat.id);
    } catch (e) {
      setError(e);
    } finally {
      setWorktreeBusy(false);
      void worktree.refetch();
      void qc.invalidateQueries({ queryKey: ["working-tree", "project"] });
      void qc.invalidateQueries({ queryKey: ["project-chats", project.id] });
    }
  }
  const removeWorktree = () =>
    worktreeAction(async (chatId) => {
      await api.removeProjectWorktree(chatId);
      // What ran in it stopped with it.
      void qc.invalidateQueries({ queryKey: ["project-tasks", project.id] });
    });
  const workspaceControl =
    scope.kind !== "project" || project.plain ? undefined : !chat ? (
      <WorkspacePicker
        value={workspace}
        onChange={setWorkspace}
        disabled={busy}
      />
    ) : chat.worktree ? (
      <WorktreeMenu
        status={worktree.data}
        running={running}
        busy={worktreeBusy}
        onShowChanges={() => {
          const status = worktree.data;
          if (status?.files.length)
            onOpenTurnDiff({
              chatId: chat.id,
              messageId: "worktree",
              files: status.files,
              label: status.branch ?? "Worktree",
              worktree: true,
            });
        }}
        onReveal={() => void api.revealProjectWorktree(chat.id).catch(setError)}
        onRemove={() => {
          if (worktree.data?.files.length) setRemovingWorktree(true);
          else void removeWorktree();
        }}
      />
    ) : (
      <CheckoutControl
        worktrees={chat.agentWorktrees}
        onReveal={(path) =>
          void api.revealAgentWorktree(chat.id, path).catch(setError)
        }
      />
    );
  // A first message scheduled with Send later still shows, to send or take back.
  const isEmpty =
    !messages.length &&
    !history.data?.scheduled?.length &&
    !history.error &&
    (!chat || !history.isPending);
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
    // height for the real one, and images and code load late. Stay pinned,
    // or keep the message the reader came back to where it was: the ones
    // around it only take their real heights a frame after it's placed.
    const observer = new ResizeObserver(() => {
      const el = scroll.current;
      if (!el) return;
      if (follow.current) el.scrollTop = el.scrollHeight;
      else if (returning.current && scrollToPlace(el, returning.current))
        placed.current = el.scrollTop;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [isEmpty]);
  const peers =
    presence.data?.filter((p) => p.userId !== chat?.shared?.memberId) ?? [];
  const contextButtons = (
    <>
      {/* A thread's scope is fixed once it starts; another takes a new thread. */}
      {isEmpty && !project.plain && (
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
              {scope.kind === "pr" ? `PR #${scope.ref.number}` : "Review a PR"}
              <ChevronDown size={12} />
            </button>
          )}
          <button
            className={`thread-context-button ${scope.kind === "review" ? "selected" : ""}`}
            onClick={onDeepReview}
            disabled={dirty}
          >
            <ScanSearch size={14} />
            Deep review
          </button>
        </>
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
  );
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
        {chat && !project.plain && (
          <button
            className="text-button"
            aria-label="Share conversation"
            onClick={onShare}
            disabled={
              (!chat.shared &&
                messages.some((message) => message.images?.length)) ||
              chat.scope.kind === "review"
            }
            title={
              chat.scope.kind === "review"
                ? "Deep reviews can't be shared yet"
                : !chat.shared &&
                    messages.some((message) => message.images?.length)
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
            // Holding a message in place scrolls too; the reader scrolling
            // anywhere else lets it go.
            if (returning.current) {
              if (e.scrollTop === placed.current) return;
              returning.current = undefined;
            }
            if (follow.current) {
              readingPlaces.delete(place);
              return;
            }
            const top = placeInView(e);
            if (top) readingPlaces.set(place, top);
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
            {root && (
              <h2 className="reply-heading">
                {root.side ? "Side question" : "Side conversation"}
              </h2>
            )}
            {shown.length > visible && (
              <button
                className="load-more"
                onClick={() => {
                  // They go in above the message being read, which stays put.
                  returning.current = placeInView(scroll.current!);
                  setVisible((v) => v + 80);
                }}
              >
                Earlier messages
              </button>
            )}
            {listed.slice(-visible).map((m) =>
              m.side ? (
                <SideQuestion
                  key={m.id}
                  message={m}
                  thread={root ? undefined : sideThreads.get(m.id)}
                  onOpen={() => openReply(m)}
                />
              ) : review && m.id === review.request ? (
                <Fragment key={m.id}>
                  <DeepReviewRequest message={m} state={review} />
                  <DeepReviewCouncil
                    state={review}
                    hasLead={leadAnswered}
                    busy={busy}
                    projectRoot={project.path}
                    onOpenFile={openFile}
                    onResume={resumeReview}
                  />
                </Fragment>
              ) : (
                <Message
                  key={m.id}
                  message={m}
                  chatId={chat?.id ?? ""}
                  onReply={openReply}
                  onFork={
                    chat?.scope.kind === "review" || root?.side
                      ? undefined
                      : forkThread
                  }
                  onChanges={openChanges}
                  onTurnDiff={openTurnDiff}
                  onRewind={rewindTurn}
                  projectRoot={folder}
                  onOpenFile={openFile}
                  replyCount={root ? 0 : (replyCounts.get(m.id) ?? 0)}
                  {...(chat && review?.report?.messageId === m.id
                    ? {
                        inlineCode: reviewCode,
                        after: (
                          <DeepReviewReport
                            chatId={chat.id}
                            state={review}
                            // A fix asked for while the lead works would wait in the
                            // queue, its findings still open to ask for again.
                            busy={busy || running}
                            onFix={(findings) => void fixFindings(findings)}
                            onStatus={setFindingStatus}
                            onOpenFile={openFile}
                          />
                        ),
                      }
                    : {})}
                  {...(plans?.[m.id]
                    ? {
                        after: (
                          <UltraplanCouncil
                            state={plans[m.id]!}
                            brief={messages.find(
                              (b) => b.id === plans[m.id]!.brief,
                            )}
                            busy={busy}
                            projectRoot={folder}
                            onOpenFile={openFile}
                            onResume={() => resumeUltraplan(m.id)}
                          />
                        ),
                      }
                    : {})}
                />
              ),
            )}
            {!root && worktree.data && (
              <WorktreeLanded status={worktree.data} />
            )}
            {!running &&
              listed.some(
                (m) => m.role === "assistant" && !m.compaction && !m.handoff,
              ) &&
              ["cancelled", "failed"].includes(
                listed
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
                  : scope.kind === "review"
                    ? `Deep review of ${project.name}`
                    : `What should we work on in ${project.name}?`
              }
            >
              {scope.kind === "pr" ? (
                <>Let’s review PR #{scope.ref.number} in </>
              ) : scope.kind === "review" ? (
                <>Deep review of </>
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
              {scope.kind === "pr" ? "." : scope.kind === "review" ? "" : "?"}
            </h1>
            <p>
              {scope.kind === "pr"
                ? "Ask about the changes. Open the review when you’re ready."
                : scope.kind === "review"
                  ? "Reviewers read the changes on their own. The lead checks what they found, then fixes it with you."
                  : project.plain
                    ? "Understand the code or work on an idea."
                    : "Understand the code, work on an idea, or review your changes."}
            </p>
          </div>
        )}
        {!!error && <ErrorBox error={error} />}
        {isEmpty && scope.kind === "review" && !chat ? (
          <DeepReviewSetup
            project={project}
            context={contextButtons}
            branch={checkout.data?.branch}
            changes={checkout.data?.changes.length ?? 0}
            canChoosePR={canChoosePR}
            busy={busy}
            checkoutDisabled={dirty}
            onStart={startReview}
          />
        ) : (
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
                      root.role === "assistant" || root.side
                        ? root.provider
                        : undefined,
                  }
                : undefined
            }
            draftKey={draftKey}
            onDraft={onDraft}
            shared={!!chat?.shared}
            // A side thread doesn't wait for the main answer, nor queue behind it.
            running={root?.side ? false : running || reviewing || planning}
            busy={busy}
            branch={checkout.data?.branch}
            plain={project.plain}
            projectId={project.id}
            checkoutDisabled={dirty}
            workspace={workspaceControl}
            branchLabel={
              worktree.data?.path && !worktree.data.removed
                ? worktree.data.branch
                : undefined
            }
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
              root?.side
                ? `Ask ${root.provider === "codex" ? "Codex" : "Claude"} a follow-up on the side…`
                : reviewing
                  ? "Reviewers are at work. Messages wait for the lead…"
                  : planning
                    ? "The council is thinking. Messages wait for the lead's plan…"
                    : pending?.some((p) => p.kind === "task")
                      ? "Message Claude, its background work keeps going…"
                      : pending
                        ? "Message Claude now, or wait for it to check back…"
                        : undefined
            }
            ultraplanOffered={!root && !chat?.shared && scope.kind !== "review"}
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
            context={contextButtons}
            allowEmpty={!root && (!!workItem || !!codeRefs.length)}
            attachment={
              !root && (selection || workItem || codeRefs.length) ? (
                <>
                  {!!codeRefs.length && (
                    <CodeReferenceList
                      references={codeRefs}
                      onRemove={(index) =>
                        setCodeRefs((refs) =>
                          refs.filter((_, i) => i !== index),
                        )
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
                        {selection.side === "deletions"
                          ? "Before PR"
                          : "PR head"}{" "}
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
        )}
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
      {removingWorktree && (
        <RemoveWorktreeDialog
          files={worktree.data?.files.length ?? 0}
          from={worktree.data?.from}
          onCancel={() => setRemovingWorktree(false)}
          onRemove={() => {
            setRemovingWorktree(false);
            void removeWorktree();
          }}
        />
      )}
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
