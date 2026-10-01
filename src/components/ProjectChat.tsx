import { AgentRequestCard } from "./AgentRequestCard";
import type { RelayCommand } from "../../shared/commands";
import { contextAgent, threadContextAgent } from "../../shared/recipient";
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
import { X, RotateCcw } from "lucide-react";
import { chatSettled } from "../../shared/chat-activity";
import {
  type ChatSummary,
  type Project,
  type ChatScope,
  type ChatWorkspace,
} from "../../shared/projects";
import { api } from "../lib/api";
import { workingTreeKey } from "../lib/working-tree-key";
import { useNavigationLock } from "../lib/navigation-lock";
import { readDraft, writeDraft } from "../lib/drafts";
import { threadDraftKey, threadStorage } from "../lib/thread-storage";
import { ErrorBox, IconButton, Loading } from "./ui";
import { ThreadHeader } from "./ThreadHeader";
import {
  ProjectComposer,
  type ComposerControls,
  type ComposerHandle,
} from "./ProjectComposer";
import { AgentSwitchDialog } from "./AgentSwitchDialog";
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
import { useAgentSwitch } from "../lib/useAgentSwitch";
import { useSessionCommands } from "../lib/useSessionCommands";
import { useThreadSend } from "../lib/useThreadSend";
import { useQueuedMessages } from "../lib/useQueuedMessages";
import { QueuedMessages } from "./QueuedMessages";
import { SideQuestion } from "./SideQuestion";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { ScopeButtons } from "./ThreadScope";
import { ProjectHeadlinePicker } from "./ProjectHeadlinePicker";
import { ScratchpadWord } from "./ScratchpadWord";
import { WorkItemCards, WorkItemChip } from "./WorkItemCards";
import type { CodeReference } from "../../shared/code-references";
import { CodeReferenceList } from "./CodeReferenceChip";
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
import { agentName } from "../../shared/agents";
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
  const writes = useThreadWrites(),
    { busy, error, setError } = writes;
  const presence = useChatPresence(chat, viewing);
  const attachments = useComposerAttachments(id),
    { selection, setSelection, workItem, setWorkItem, codeRefs, setCodeRefs } =
      attachments;
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
  const { context, compacting, showContext, compact, runCommand } =
    useSessionCommands({
      chat,
      shown,
      root: root?.id ?? null,
      running,
      writes,
      refetch: history.refetch,
      onCommand,
    });
  const agentSwitch = useAgentSwitch(contextAgent(shown, root?.id));
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
  const draftKey = threadDraftKey(id, root?.id);
  const onDraft = (v: string) => writeDraft(draftKey, v);
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
        writeDraft(key, `${old}${old ? "\n\n" : ""}${text}`);
      }
      onContextUsed();
    }
  }, [contextText?.id]);
  const { send, resume } = useThreadSend({
    chat,
    draftId: id,
    projectId: project.id,
    create: () =>
      api.createProjectChat(
        project.id,
        scope,
        scope.kind === "project" ? workspace : undefined,
      ),
    root,
    attachments,
    viewing: viewing.path,
    writes,
    confirmSwitch: agentSwitch.confirm,
    refetch: history.refetch,
    onCreated,
    onSent: () => followAnswer(),
    onOpen: setRootId,
  });
  const { restored, steer, move, returnToComposer } = useQueuedMessages({
    chat,
    draftId: id,
    projectId: project.id,
    messages,
    queue: history.data?.queue,
    attachments,
    writes,
    refetch: history.refetch,
    onOpen: setRootId,
  });
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
  const scopeButtons = (
    <ScopeButtons
      project={project}
      scope={scope}
      choosing={isEmpty}
      canChoosePR={canChoosePR}
      onRepository={onRepository}
      onChoosePR={onChoosePR}
      onSelectPR={onSelectPR}
      onDeepReview={onDeepReview}
      onReviewChanges={openChanges}
    />
  );
  return (
    <section
      className={`project-chat ${isEmpty ? "empty-thread" : ""}${chat && agentView ? " agent-open" : ""}`}
      aria-label="Project chat"
      style={{ "--composer-dock-height": `${dockHeight}px` } as CSSProperties}
    >
      <ThreadHeader
        chat={chat}
        plain={project.plain}
        presence={presence}
        screenshots={messages.some((message) => message.images?.length)}
        onShare={onShare}
        onBack={root ? () => setRootId(null) : undefined}
      />
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
                  onClick={() =>
                    void resume(() => composer.current?.agentSettings())
                  }
                >
                  <RotateCcw size={13} /> Resume answer
                </button>
              )}
            <QueuedMessages
              queue={history.data?.queue}
              paused={history.data?.queuePaused}
              scheduled={history.data?.scheduled}
              running={running}
              busy={busy}
              onSteer={steer}
              onMove={move}
              onReturn={returnToComposer}
            />
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
            context={scopeButtons}
            branch={checkout.data?.branch}
            changes={checkout.data?.changes.length ?? 0}
            canChoosePR={canChoosePR}
            busy={busy}
            checkoutDisabled={checkoutDisabled}
            onStart={startReview}
          />
        ) : (
          <ProjectComposer
            key={`${id}:${root?.id ?? "main"}:${restored}`}
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
            context={scopeButtons}
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
      {agentSwitch.asking && (
        <AgentSwitchDialog
          from={agentSwitch.asking.from}
          to={agentSwitch.asking.to}
          onDecide={agentSwitch.decide}
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
