import { AgentRequestCard } from "./AgentRequestCard";
import type { RelayCommand } from "../../shared/commands";
import {
  agentAsked,
  contextAgent,
  recipient,
  threadContextAgent,
} from "../../shared/recipient";
import type { LineQuestion } from "../../shared/questions";
import {
  Fragment,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LockKeyhole,
  Users,
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
import { chatSettled, wakeLabel } from "../../shared/chat-activity";
import {
  replyRoot,
  type ChatSummary,
  type Project,
  type ChatScope,
  type ChatWorkspace,
  type ProjectChatSend,
  type AgentProvider,
  type ProjectChat as ProjectChatData,
} from "../../shared/projects";
import { api } from "../lib/api";
import { workingTreeKey } from "../lib/working-tree-key";
import { useNavigationLock } from "../lib/navigation-lock";
import { loadDraftImages, saveDraftImages } from "../lib/draft-images";
import {
  attachedImages,
  imagesAfter,
  nextImageNumber,
} from "../lib/image-refs";
import { readDraft, saveDraftWorkspace, writeDraft } from "../lib/drafts";
import { withAttachments } from "../lib/draft-attachments";
import { threadDraftKey, threadStorage } from "../lib/thread-storage";
import type { ComposedSend } from "../../shared/compose-send";
import {
  startThreadSettings,
  saveSentSettings,
} from "../lib/composer-settings";
import { sendKeyLabel, steerKeyLabel, useSendKey } from "../lib/send-key";
import { ErrorBox, IconButton, Loading } from "./ui";
import { LiveSyncControls } from "./LiveSyncControls";
import {
  ProjectComposer,
  type ComposerControls,
  type ComposerHandle,
} from "./ProjectComposer";
import {
  AgentSwitchDialog,
  agentSwitchNoticeHidden,
} from "./AgentSwitchDialog";
import { SelectionQuote } from "./SelectionQuote";
import { Message } from "./ProjectMessage";
import { useCouncils } from "../lib/useCouncils";
import { useChatThread } from "../lib/useChatThread";
import { useChatPresence } from "../lib/useChatPresence";
import { useBackgroundWork } from "../lib/useBackgroundWork";
import { useThreadScroll } from "../lib/useThreadScroll";
import { useMessageActions } from "../lib/useMessageActions";
import { useThreadWrites } from "../lib/useThreadWrites";
import { useComposerAttachments } from "../lib/useComposerAttachments";
import { SideQuestion } from "./SideQuestion";
import { ContextWindowMeter, latestContext } from "./ContextWindowMeter";
import { ProjectPullPicker } from "./ProjectPullPicker";
import { ProjectHeadlinePicker } from "./ProjectHeadlinePicker";
import { ScratchpadWord } from "./ScratchpadWord";
import { WorkItemCards, WorkItemChip } from "./WorkItemCards";
import {
  parseCodeReferences,
  type CodeReference,
} from "../../shared/code-references";
import { CodeReferenceList } from "./CodeReferenceChip";
import {
  pastedTexts,
  pastesAfter,
  replacePastedTexts,
} from "../../shared/pasted-texts";
import { SettledStrip, StoppedStrip, WaitingStrip } from "./WaitingStrip";
import { awayPlaceholder, HandoffStrip, ReturnedStrip } from "./HandoffStrip";
import { SubagentsIndicator } from "./Subagents";
import { SubagentThread } from "./SubagentThread";
import {
  WorkspaceControl,
  WorktreeDialogs,
  WorktreeLanded,
} from "./WorktreeControls";
import { useThreadWorktree } from "../lib/useThreadWorktree";
import type { TurnDiffTarget } from "./TurnChanges";
import type { ProjectFileLink } from "../../shared/project-file-links";
import type { PullRef } from "../../shared/types";
import {
  DeepReviewCouncil,
  DeepReviewReport,
  DeepReviewRequest,
  DeepReviewSetup,
} from "./DeepReview";
import { UltraplanCouncil } from "./Ultraplan";
import {
  agentMentionPattern,
  agentName,
  agentProviders,
  agents as agentInfo,
} from "../../shared/agents";
/** A queued message's text, with its attachments counted rather than shown. */
function QueuedBody({ input }: { input: ProjectChatSend }) {
  const code = parseCodeReferences(input.body);
  const pastes = pastedTexts(code.body);
  const body = replacePastedTexts(code.body, () => "\n\n").trim();
  return (
    <>
      <p>{body.replace(agentMentionPattern, "")}</p>
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
/** Drag type for reordering queued messages, so other drops are ignored. */
const QUEUED_DRAG = "application/x-relay-queued-message";
export function ProjectChat({
  onCommand,
  project,
  projects,
  chat,
  draftId,
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
  onOpenCode,
  onOpenFile,
  onOpenTurnDiff,
  onDraftWorkspace,
  onStartThread,
  viewing,
  ref,
}: {
  onCommand: (command: RelayCommand, args: string) => boolean | string;
  project: Project;
  projects: Project[];
  chat?: ChatSummary;
  /** The unsent thread shown while there's no `chat`; see lib/drafts. */
  draftId: string;
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
  onOpenCode: (mode: "changes" | "files") => void;
  onOpenFile: (target: ProjectFileLink) => void;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
  /** Where the unsent thread will work, as the picker changes. */
  onDraftWorkspace?: (workspace: ChatWorkspace) => void;
  /** Opens a new project-folder thread on `text`, sent or as a draft. */
  onStartThread?: (text: string, send: boolean) => Promise<void>;
  viewing: { path: string | null; viewed: number; total: number };
  /** The thread's composer, while it shows one. */
  ref?: Ref<ComposerControls>;
}) {
  const qc = useQueryClient(),
    id = chat?.id ?? draftId,
    scope = chat?.scope ?? draftScope;
  // Checking out another branch would change the file under an unsaved edit.
  const { locked: checkoutDisabled } = useNavigationLock();
  // Refreshed by the shell's working-tree poll.
  const checkout = useQuery({
    queryKey: workingTreeKey(project.id),
    queryFn: () => api.projectWorkingTree(project.id),
    enabled: !project.plain,
  });
  const [rootId, setRootId] = useState<string | null>(() =>
    threadStorage(id).reply.load(),
  );
  const {
    history,
    messages,
    root,
    shown,
    listed,
    running,
    replyCounts,
    sideThreads,
    leadAnswered,
  } = useChatThread(chat, rootId);
  const [composerRevision, setComposerRevision] = useState(0);
  const writes = useThreadWrites(),
    { busy, error, setError, run } = writes;
  const { peers, sharePresence, setSharePresence } = useChatPresence(
    chat,
    viewing,
  );
  const [sharingOpen, setSharingOpen] = useState(false);
  const attachments = useComposerAttachments(id),
    { selection, setSelection, workItem, setWorkItem, codeRefs, setCodeRefs } =
      attachments;
  const created = useRef<ChatSummary | undefined>(undefined);
  const place = `${id}:${rootId ?? ""}`;
  const composer = useRef<ComposerHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => composer.current?.focus(),
      submit: () => composer.current?.submit(),
    }),
    [],
  );
  const worktree = useThreadWorktree({
    chat,
    draftId: id,
    project,
    running,
    setError,
    onDraftWorkspace,
  });
  const { workspace, folder } = worktree;
  const { agents, agentBatch, pending, stopped, leftBehind } =
    useBackgroundWork(chat, running);
  const unsettle = async () => {
    if (!chat) return;
    qc.setQueriesData<ChatSummary[]>({ queryKey: ["project-chats"] }, (list) =>
      list?.map((c) => (c.id === chat.id ? { ...c, settledAt: undefined } : c)),
    );
    try {
      await api.triageProjectChat(chat.id, { kind: "unsettle" });
    } catch (e) {
      setError(e);
    } finally {
      void qc.invalidateQueries({ queryKey: ["project-chats"] });
    }
  };
  // The agent whose run covers the conversation, as a side thread.
  const [agentView, setAgentView] = useState<string | null>(null);
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
  const activeAgent = contextAgent(shown, root?.id);
  const {
    review,
    reviewing,
    plans,
    planning,
    reviewCode,
    startReview,
    fixFindings,
    setFindingStatus,
    resumeReview,
    resumeUltraplan,
  } = useCouncils({
    chat,
    projectId: project.id,
    data: history.data,
    refetch: history.refetch,
    writes,
    onCreated,
    onSent: () => followAnswer(),
  });
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
      if (args && !agentInfo[context.provider].compactInstructions)
        return `${agentName(context.provider)} compacts without custom instructions.`;
      compact(args || undefined);
      return true;
    }
    // With a question and an agent picked, the composer sends it itself.
    if (command === "btw")
      return args
        ? `Pick ${agentProviders.map(agentName).join(" or ")} to ask a side question.`
        : "Type your question after /btw.";
    if (command === "context") {
      if (!chat || !context)
        return "Context usage appears after the first answer.";
      setShowContext((n) => n + 1);
      return true;
    }
    return onCommand(command, args);
  }
  const draftKey = threadDraftKey(id, root?.id);
  const onDraft = (v: string, key = draftKey) => writeDraft(key, v);
  useLayoutEffect(() => {
    threadStorage(id).reply.save(rootId);
  }, [place]);
  useEffect(() => {
    if (contextText) {
      setRootId(null);
      const { code, text } = contextText;
      if (code) attachments.addCodeRefs([code]);
      else setSelection(contextText.selection);
      if (text) {
        const key = threadDraftKey(id),
          old = readDraft(key);
        onDraft(`${old}${old ? "\n\n" : ""}${text}`, key);
      }
      onContextUsed();
    }
  }, [contextText?.id]);
  /** Taking over from another agent loses its session: say so first. */
  async function confirmSwitch(to: AgentProvider | undefined) {
    return (
      !to ||
      !activeAgent ||
      to === activeAgent ||
      agentSwitchNoticeHidden() ||
      new Promise<boolean>((resolve) =>
        setAgentSwitch({ from: activeAgent, to, resolve }),
      )
    );
  }
  /** Carries on the stopped answer with whichever agent the composer has picked. */
  async function resume() {
    if (!chat || busy) return;
    const settings = composer.current?.agentSettings();
    if (!(await confirmSwitch(settings?.provider))) return;
    await run(async () => {
      await api.resumeProjectChat(chat.id, settings);
      await history.refetch();
    });
  }
  async function send(
    value: ComposedSend,
    dispatch?: () => void,
  ): Promise<boolean> {
    if (busy) return false;
    if (value.side) return askAside(value, dispatch);
    if (!(await confirmSwitch(agentAsked(value)?.provider))) return false;
    dispatch?.();
    return run(async () => {
      const target =
        chat ??
        created.current ??
        (await api.createProjectChat(
          project.id,
          scope,
          scope.kind === "project" ? workspace : undefined,
        ));
      created.current = target;
      await api.sendProjectChat(target.id, {
        // A side conversation leaves the thread's attachments waiting.
        ...withAttachments(
          value,
          root ? { codeRefs: [] } : { workItem, codeRefs, selection },
        ),
        id: crypto.randomUUID(),
        ...(root ? { parentId: root.id } : {}),
        ...(viewing.path ? { viewing: viewing.path } : {}),
      });
      if (!root) attachments.clear();
      followAnswer();
      if (!chat) {
        saveDraftWorkspace(id, "checkout");
        startThreadSettings(id, target.id, recipient(value));
        await onCreated(target);
      } else await history.refetch();
      await qc.invalidateQueries({ queryKey: ["project-chats", project.id] });
    });
  }
  /** `/btw`: its thread opens, and the main thread's draft and attachments wait. */
  async function askAside(value: ComposedSend, dispatch?: () => void) {
    if (!chat) {
      setError(
        new Error("Ask the agent something first, then ask on the side."),
      );
      return false;
    }
    dispatch?.();
    return run(async () => {
      const question = crypto.randomUUID();
      await api.sendProjectChat(chat.id, {
        ...value,
        id: question,
        side: true,
      });
      await history.refetch();
      setRootId(question);
    });
  }
  async function returnToComposer(input: ProjectChatSend) {
    if (!chat || busy) return;
    await run(async () => {
      const parent = input.parentId
        ? replyRoot(messages, input.parentId).id
        : null;
      const key = threadDraftKey(id, parent);
      const old = readDraft(key);
      const restoredCode = parent
        ? { refs: [], body: input.body }
        : parseCodeReferences(input.body);
      const existing = await loadDraftImages(key);
      // The message's tokens count on from the draft's own.
      const back = imagesAfter(
        pastesAfter(old, restoredCode.body),
        (input.images ?? []).map((image) => ({
          ...image,
          id: crypto.randomUUID(),
        })),
        nextImageNumber(old, existing) - 1,
      );
      const body = [old.trim(), back.text.trim()].filter(Boolean).join("\n\n");
      if (body.length > 32000)
        throw new Error(
          "Send or shorten the current draft before restoring this message.",
        );
      const restored = [...attachedImages(old, existing), ...back.images];
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
        recipient(input),
        input,
      );
      attachments.addCodeRefs(restoredCode.refs);
      // The queue entry goes next.
      if (input.selection) attachments.restoreSelection(input.selection);
      setRootId(parent);
      setComposerRevision((value) => value + 1);
      await api.projectChatQueueAction(chat.id, "remove", input.id);
      await history.refetch();
      void qc.invalidateQueries({ queryKey: ["project-chats", project.id] });
    });
  }
  async function queueAction(
    action: "remove" | "steer" | "move",
    messageId: string,
    index?: number,
  ) {
    if (!chat || busy) return;
    await run(async () => {
      await api.projectChatQueueAction(chat.id, action, messageId, index);
      await history.refetch();
      void qc.invalidateQueries({ queryKey: ["project-chats", project.id] });
    });
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
  const {
    signInToClaude,
    openReply,
    forkThread,
    openChanges,
    openFile,
    openTurnDiff,
    rewindTurn,
  } = useMessageActions({
    projectId: project.id,
    chatId: chat?.id,
    messages,
    worktree: worktree.status,
    setError,
    onOpenReply: setRootId,
    onCreated,
    onOpenCode,
    onOpenFile,
    onOpenTurnDiff,
  });
  const workspaceControl =
    scope.kind !== "project" || project.plain ? undefined : (
      <WorkspaceControl
        chat={chat}
        worktree={worktree}
        running={running}
        busy={busy}
        onOpenTurnDiff={onOpenTurnDiff}
        onError={setError}
      />
    );
  // A first message scheduled with Send later still shows, to send or take back.
  const isEmpty =
    !messages.length &&
    !history.data?.scheduled?.length &&
    !history.error &&
    (!chat || !history.isPending);
  const {
    scroll,
    column,
    composerDock,
    onScroll,
    visible,
    earlier,
    showEarlier,
    scrolledUp,
    dockHeight,
    followAnswer,
  } = useThreadScroll({
    place,
    rootId,
    messages,
    shown,
    opened: !!history.data,
    isEmpty,
  });
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
              compact
            />
          ) : (
            <button
              className={`thread-context-button ${scope.kind === "pr" ? "selected" : ""}`}
              onClick={onChoosePR}
            >
              <GitPullRequest size={14} />
              {scope.kind === "pr" ? `PR #${scope.ref.number}` : "Review a PR"}
              <ChevronDown size={12} />
            </button>
          )}
          <button
            className={`thread-context-button ${scope.kind === "review" ? "selected" : ""}`}
            onClick={onDeepReview}
          >
            <ScanSearch size={14} />
            Deep review
          </button>
        </>
      )}
      {scope.kind === "pr" && (
        <button
          className="thread-review-action"
          onClick={() => onOpenCode("changes")}
        >
          Review changes →
        </button>
      )}
    </>
  );
  return (
    <section
      className={`project-chat ${isEmpty ? "empty-thread" : ""}${chat && agentView ? " agent-open" : ""}`}
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
              onChange={(e) => setSharePresence(e.target.checked)}
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
        <div className="project-messages" ref={scroll} onScroll={onScroll}>
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
            {earlier && (
              <button className="load-more" onClick={showEarlier}>
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
                  onSignIn={
                    m.signIn && m.id === listed.at(-1)?.id
                      ? signInToClaude
                      : undefined
                  }
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
            {!root && worktree.status && (
              <WorktreeLanded status={worktree.status} />
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
                  onClick={() => void resume()}
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

        {isEmpty && project.scratch && (
          <div className="thread-introduction">
            <h1 aria-label="What should we work on in Scratchpad?">
              What should we work on in <ScratchpadWord />?
            </h1>
          </div>
        )}
        {isEmpty && !project.scratch && (
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
            settingsKey={id}
            context={contextButtons}
            branch={checkout.data?.branch}
            changes={checkout.data?.changes.length ?? 0}
            canChoosePR={canChoosePR}
            busy={busy}
            checkoutDisabled={checkoutDisabled}
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
            agent={chat && threadContextAgent(chat)}
            draftKey={draftKey}
            onDraft={onDraft}
            shared={!!chat?.shared}
            // A side thread doesn't wait for the main answer, nor queue behind it.
            running={root?.side ? false : running || reviewing || planning}
            busy={busy || !!chat?.sentTo || !!chat?.cameFrom?.returnedAt}
            branch={checkout.data?.branch}
            plain={project.plain}
            projectId={project.id}
            checkoutDisabled={checkoutDisabled}
            onStartThread={onStartThread}
            workspace={
              <>
                {agentBatch.length > 0 && (
                  <SubagentsIndicator
                    batch={agentBatch}
                    projectRoot={folder}
                    onOpen={setAgentView}
                    onStop={async (id) => {
                      if (!chat) return;
                      try {
                        await api.stopProjectChatAgent(chat.id, id);
                      } catch (e) {
                        setError(e);
                        throw e;
                      } finally {
                        void qc.invalidateQueries({
                          queryKey: ["project-chat-agents", chat.id],
                        });
                      }
                    }}
                  />
                )}
                {workspaceControl}
              </>
            }
            branchLabel={worktree.branch}
            onSend={send}
            notice={
              chat?.sentTo ? (
                <HandoffStrip chat={chat} onError={setError} />
              ) : chat?.cameFrom?.returnedAt ? (
                <ReturnedStrip computer={chat.cameFrom.computer} />
              ) : stopped?.length ? (
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
              ) : leftBehind?.length ? (
                <WaitingStrip
                  pending={leftBehind}
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
              ) : (
                chat &&
                chatSettled(chat) && <SettledStrip onUnsettle={unsettle} />
              )
            }
            placeholder={
              (chat && awayPlaceholder(chat)) ??
              (root?.side
                ? `Ask ${agentName(root.provider)} a follow-up on the side…`
                : reviewing
                  ? "Reviewers are at work. Messages wait for the lead…"
                  : planning
                    ? "The council is thinking. Messages wait for the lead's plan…"
                    : pending?.some((p) => p.kind === "task")
                      ? "Message Claude, its background work keeps going…"
                      : pending
                        ? "Message Claude now, or wait for it to check back…"
                        : project.scratch
                          ? "Ask anything…"
                          : undefined)
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
              requestAnimationFrame(() => composer.current?.focus());
            }}
          />
        )}
      </div>
      <WorktreeDialogs chat={chat} worktree={worktree} />
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
      {chat && agentView && (
        <SubagentThread
          chatId={chat.id}
          runs={agents}
          openId={agentView}
          projectRoot={folder}
          onSelect={setAgentView}
          onClose={() => setAgentView(null)}
          onOpenFile={openFile}
          onChanges={openChanges}
        />
      )}
    </section>
  );
}
