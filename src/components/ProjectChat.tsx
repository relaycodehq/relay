import { AgentRequestCard } from "./AgentRequestCard";
import type { RelayCommand } from "../../shared/commands";
import { contextAgent, threadContextAgent } from "../../shared/recipient";
import type { LineQuestion } from "../../shared/questions";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
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
import { ErrorBox, IconButton } from "./ui";
import { ThreadHeader } from "./ThreadHeader";
import {
  ProjectComposer,
  type ComposerControls,
  type ComposerHandle,
} from "./ProjectComposer";
import { AgentSwitchDialog } from "./AgentSwitchDialog";
import { SelectionQuote } from "./SelectionQuote";
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
import { ThreadMessages } from "./ThreadMessages";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { ScopeButtons, ThreadIntroduction } from "./ThreadScope";
import { WorkItemCards, WorkItemChip } from "./WorkItemCards";
import type { CodeReference } from "../../shared/code-references";
import { CodeReferenceList } from "./CodeReferenceChip";
import { awayPlaceholder } from "./HandoffStrip";
import { ThreadNotice } from "./ThreadNotice";
import { SubagentsIndicator } from "./Subagents";
import { SubagentThread } from "./SubagentThread";
import { WorkspaceControl, WorktreeDialogs } from "./WorktreeControls";
import { useThreadWorktree } from "../lib/useThreadWorktree";
import type { TurnDiffTarget } from "./TurnChanges";
import type { ProjectFileLink } from "../../shared/project-file-links";
import type { PullRef } from "../../shared/types";
import { DeepReviewSetup } from "./DeepReview";
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
  const thread = useChatThread(chat, rootId),
    { history, messages, root, shown, running } = thread;
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
  const councils = useCouncils({
    chat,
    projectId: project.id,
    data: history.data,
    refetch: history.refetch,
    writes,
    onCreated,
    onSent: () => followAnswer(),
  });
  const { reviewing, planning, startReview } = councils;
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
  const queue = useQueuedMessages({
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
  const actions = useMessageActions({
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
  const { openChanges, openFile } = actions;
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
  const view = useThreadScroll({
    place,
    rootId,
    messages,
    shown,
    opened: !!history.data,
    isEmpty,
  });
  const { scroll, composerDock, scrolledUp, dockHeight, followAnswer } = view;
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
        <ThreadMessages
          chat={chat}
          projectPath={project.path}
          thread={thread}
          view={view}
          councils={councils}
          actions={actions}
          queue={queue}
          worktree={worktree}
          busy={busy}
          onResume={() => void resume(() => composer.current?.agentSettings())}
        />
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
          <ThreadIntroduction
            project={project}
            projects={projects}
            scope={scope}
            onSwitchProject={onSwitchProject}
            onAddProject={onAddProject}
          />
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
            key={`${id}:${root?.id ?? "main"}:${queue.restored}`}
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
              chat && (
                <ThreadNotice
                  chat={chat}
                  stopped={stopped}
                  leftBehind={leftBehind}
                  onError={setError}
                />
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
