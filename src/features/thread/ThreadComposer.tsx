import { useCallback, useMemo, useRef, type ReactNode, type Ref } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { agentName } from "../../../shared/agents";
import type { CommandOption, RelayCommand } from "../../../shared/commands";
import type { ComposedSend } from "../../../shared/compose-send";
import { latestContextReport } from "../../../shared/context-report";
import { openPlan } from "../../../shared/open-plan";
import type { ChatScope, Project } from "../../../shared/projects";
import { threadContextAgent } from "../../../shared/recipient";
import { api } from "../../lib/api";
import { threadDraftKey } from "../../lib/thread-storage";
import type { TurnDiffTarget } from "../changes/turn-diff";
import type { BackgroundWork } from "./useBackgroundWork";
import type { ChatThread } from "./useChatThread";
import type { ComposerAttachments } from "./useComposerAttachments";
import type { Councils } from "./useCouncils";
import type { SessionCommands } from "./useSessionCommands";
import type { ThreadHandle } from "./useThreadHandle";
import type { ThreadWorktree } from "./useThreadWorktree";
import { CodeReferenceList } from "./CodeReferenceChip";
import { ContextWindowMeter } from "../agents/ContextWindowMeter";
import { useCacheExpired } from "../agents/auto-compact";
import { compactsCold } from "../../../shared/context-usage";
import { awayPlaceholder } from "../handoff/HandoffStrip";
import { SetupLine } from "../handoff/SetupLine";
import { inSetup, liveAway } from "../../../shared/handoff";
import {
  ProjectComposer,
  type ComposerHandle,
} from "../composer/ProjectComposer";
import { sentHistory } from "../composer/prompt-history";
import { SubagentsIndicator } from "../agent-turn/Subagents";
import { StartedChip } from "../agent-turn/StartedThreads";
import { ThreadNotice } from "./ThreadNotice";
import { ProjectBranchPicker } from "../changes/ProjectBranchPicker";
import { IconButton } from "../../ui/ui";
import { WorktreeBranch } from "../changes/WorktreeBranch";
import { WorkItemChip } from "../plugins/WorkItemCards";
import { WorkspaceControl } from "./WorktreeControls";
import { NewWorkspacePicker, StartOnNote } from "./NewWorkspacePicker";
import { HomeComputerLine, LiveAwayLine } from "../handoff/LiveAwayLine";
import { LinksControl } from "../linked-folders/LinksControl";
import type { ThreadLinks } from "../linked-folders/useThreadLinks";
import { DetourNote, NewThreadBranch } from "./NewThreadBranch";
import "../changes/branch-picker.css";
import { threadCost } from "../../../shared/thread-cost";
import { lastComposerSettings } from "../../../shared/projects";

/** What goes out with the main conversation's next message besides its text. */
function AttachedContext({
  attachments: {
    selection,
    setSelection,
    workItem,
    setWorkItem,
    codeRefs,
    setCodeRefs,
  },
}: {
  attachments: ComposerAttachments;
}) {
  return (
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
        <WorkItemChip item={workItem} onRemove={() => setWorkItem(undefined)} />
      )}
      {selection && (
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
      )}
    </>
  );
}

/** The project checkout's branch, and whether switching it is held off. */
export interface ProjectCheckout {
  branch?: string | null;
  locked: boolean;
}

/**
 * The branch the thread works on: the checkout's, to switch, or its own
 * worktree's. Before the first message, picking one also says where.
 */
function ThreadBranch({
  project,
  worktree,
  checkout,
  unsent,
  disabled,
  onStartThread,
}: {
  project: Project;
  worktree: ThreadWorktree;
  checkout: ProjectCheckout;
  /** A thread of the project's own not started yet, which picks where it works. */
  unsent: boolean;
  disabled: boolean;
  onStartThread?: (text: string, send: boolean) => Promise<void>;
}) {
  // A folder without Git has no branch to show or switch.
  if (project.plain) return null;
  if (unsent)
    return (
      <NewThreadBranch
        project={project}
        worktree={worktree}
        checkout={checkout}
        disabled={disabled}
        onStartThread={onStartThread}
      />
    );
  const picker = (
    <ProjectBranchPicker
      projectId={project.id}
      branch={checkout.branch}
      disabled={checkout.locked || disabled}
      onStartThread={onStartThread}
    />
  );
  // The deleted worktree's row asks where to carry on; its branch name would be stale.
  if (worktree.unavailable) return null;
  // Its name comes with the thread's title, a moment after sending.
  if (worktree.naming) return null;
  if (worktree.inWorktree)
    return (
      <WorktreeBranch
        key={worktree.where}
        where={worktree.where}
        branch={worktree.branch}
        held={disabled || worktree.selectionDisabled}
      />
    );
  return picker;
}

/**
 * The open conversation's composer, told what the thread is doing: whether
 * its agents are at work, what it waits on, where it works, and what the
 * agent's session holds.
 */
export function ThreadComposer({
  ref,
  handle: { chat, id, busy, setError },
  project,
  scope,
  thread: { history, root, messages, shown, running, mainRunning },
  councils: { reviewing },
  background: {
    agentBatch,
    earlierBatches,
    clearAgents,
    pending,
    stopped,
    leftBehind,
  },
  session: {
    runCommand,
    context,
    compacting,
    showContext,
    compact,
    queuedCompact,
    cancelCompact,
  },
  attachments,
  worktree,
  checkout,
  scopeButtons,
  notesChip,
  links,
  commandOptions,
  onProjectSettings,
  onSend,
  onEditQueued,
  onStartThread,
  onOpenAgent,
  onOpenTurnDiff,
}: {
  ref: Ref<ComposerHandle>;
  handle: ThreadHandle;
  project: Project;
  scope: ChatScope;
  thread: ChatThread;
  councils: Councils;
  background: BackgroundWork;
  session: SessionCommands;
  attachments: ComposerAttachments;
  worktree: ThreadWorktree;
  checkout: ProjectCheckout;
  scopeButtons: ReactNode;
  /** The notes kept in the thread, first of the controls on the right. */
  notesChip: ReactNode;
  links: ThreadLinks;
  /** Values offered after a command, e.g. folders after /add-dir. */
  commandOptions: (
    command: RelayCommand,
    query: string,
  ) => CommandOption[] | undefined;
  onProjectSettings: () => void;
  onSend: (
    value: ComposedSend,
    dispatch?: (id: string) => void,
  ) => Promise<boolean>;
  /** Takes the newest queued message back into the composer; false when none waits. */
  onEditQueued: () => boolean;
  /** Opens a new project-folder thread on `text`, sent or as a draft. */
  onStartThread?: (text: string, send: boolean) => Promise<void>;
  /** Opens a subagent's run as a side thread. */
  onOpenAgent: (id: string) => void;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
}) {
  const qc = useQueryClient();
  const savedReport = useMemo(() => latestContextReport(shown), [shown]);
  const cost = useMemo(() => threadCost(shown), [shown]);
  const cacheExpired = useCacheExpired(context?.usage.cache);
  // As the server decides in firstIfCold: a side question, or one behind
  // queued messages, goes as is.
  const cold =
    chat &&
    context &&
    cacheExpired &&
    !root?.side &&
    // Sent on to the computer it's handed to, which may not know `compact`.
    !chat.sentTo &&
    !compacting &&
    !history.data?.queue?.length &&
    !history.data?.queuePaused &&
    // Compacting resumes the session of the agent that answered last.
    shown.findLast((m) => m.role === "assistant")?.provider ===
      context.provider &&
    !!(root ? history.data?.replySessions?.[root.id] : history.data?.sessions)?.[
      context.provider
    ]?.thread &&
    compactsCold(context.usage, Date.now())
      ? { provider: context.provider, tokens: context.usage.usedTokens }
      : undefined;
  const chatId = chat?.id;
  const counter = useMemo(
    () =>
      chatId
        ? {
            key: `${chatId}:${root?.id ?? ""}:${context?.provider ?? ""}`,
            count: () => api.projectChatContext(chatId, root?.id ?? null),
          }
        : undefined,
    [chatId, root?.id, context?.provider],
  );
  const draftKey = threadDraftKey(id, root?.id);
  const { selection, workItem, codeRefs } = attachments;
  // A side thread doesn't wait for the main answer, nor queue behind it, and
  // the thread's Stop is for its own turn, not a /btw answer beside it.
  // Waiting on a setup there, it talks to that setup's agent: its answer is
  // what runs, and the agent it was sent to is the one the composer picks.
  const setup = chat && inSetup(chat) ? history.data?.setup : undefined;
  const setupRunning = !!setup?.messages.some((m) => m.status === "streaming");
  const waiting = root?.side ? false : mainRunning || reviewing || setupRunning;
  const held =
    busy ||
    (!!chat && history.isPending) ||
    worktree.unavailable ||
    (!!chat?.sentTo && !liveAway(chat) && !inSetup(chat)) ||
    !!chat?.cameFrom?.returnedAt;
  // Read on ↑ only, so streaming answers don't rebuild it.
  const shownNow = useRef(shown);
  shownNow.current = shown;
  const sent = useCallback(() => sentHistory(shownNow.current), []);
  const placeholder =
    (chat && awayPlaceholder(chat)) ??
    (root?.side
      ? `Ask ${agentName(root.provider)} a follow-up on the side…`
      : reviewing
        ? "Reviewers are at work. Messages wait for the lead…"
        : !running && pending?.some((p) => p.kind === "task")
          ? "Message Claude, its background work keeps going…"
          : !running && pending
            ? "Message Claude now, or wait for it to check back…"
            : project.scratch
              ? "Ask anything…"
              : undefined);
  return (
    <ProjectComposer
      ref={ref}
      projectId={project.id}
      computer={project.computer}
      files={worktree.where}
      keys={{
        draft: draftKey,
        // A side conversation keeps its own agent and opens on the one that wrote its message.
        settings: root ? `${id}:${root.id}` : id,
        inherit: root
          ? {
              settingsKey: id,
              provider:
                root.role === "assistant" || root.side
                  ? root.provider
                  : undefined,
            }
          : undefined,
      }}
      conversation={{
        running: waiting,
        busy: held,
        agent: chat && threadContextAgent(chat),
        lastSent:
          (setup &&
            lastComposerSettings({
              ...history.data!,
              messages: setup.messages,
              lastInput: undefined,
            })) ??
          lastComposerSettings(history.data, root?.id),
        planner: running ? undefined : openPlan(messages, shown),
        chatId: chat?.id,
        accounts: chat?.accounts,
        cold,
      }}
      context={
        <>
          {scopeButtons}
          {notesChip}
          <StartedChip ids={undefined} live />
          {agentBatch.length > 0 && (
            <SubagentsIndicator
              batch={agentBatch}
              earlier={earlierBatches}
              projectRoot={worktree.folder}
              onOpen={onOpenAgent}
              onClear={clearAgents}
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
          {scope.kind !== "project" ||
          project.plain ||
          // A project on another computer works in its folder there.
          project.computer ? undefined : !chat ? (
            <NewWorkspacePicker
              project={project}
              worktree={worktree}
              checkoutBranch={checkout.branch}
              disabled={busy}
            />
          ) : (
            <WorkspaceControl
              chat={chat}
              worktree={worktree}
              running={running}
              busy={busy}
              onOpenTurnDiff={onOpenTurnDiff}
              onError={setError}
            />
          )}
          <ThreadBranch
            project={project}
            worktree={worktree}
            checkout={checkout}
            unsent={!chat && scope.kind === "project" && !project.computer}
            disabled={waiting || held}
            onStartThread={onStartThread}
          />
          {!project.computer && (
            <LinksControl
              links={links}
              empty={!chat}
              onProjectSettings={onProjectSettings}
              onError={setError}
            />
          )}
        </>
      }
      below={
        chat && liveAway(chat) ? (
          <LiveAwayLine chat={chat} onError={setError} />
        ) : chat && inSetup(chat) ? (
          <SetupLine chat={chat} onError={setError} />
        ) : !chat && project.computer ? (
          <HomeComputerLine project={project} />
        ) : undefined
      }
      notice={({ sendGoal }) =>
        chat ? (
          <ThreadNotice
            chat={chat}
            stopped={stopped}
            leftBehind={leftBehind}
            onError={setError}
            onGoal={sendGoal}
          />
        ) : (
          <>
            <StartOnNote project={project} worktree={worktree} />
            <DetourNote project={project} worktree={worktree} />
          </>
        )
      }
      meter={
        chat &&
        context && (
          <ContextWindowMeter
            chatId={chat.id}
            usage={context.usage}
            provider={context.provider}
            compacting={compacting}
            compactDisabled={busy}
            compactLater={running}
            compactQueued={running && queuedCompact}
            openSignal={showContext}
            counter={counter}
            savedReport={savedReport}
            onCompact={() =>
              running && queuedCompact ? cancelCompact() : compact()
            }
          />
        )
      }
      threadCost={cost}
      attachment={
        !root && (selection || workItem || codeRefs.length)
          ? {
              view: <AttachedContext attachments={attachments} />,
              complete: !!workItem || !!codeRefs.length,
            }
          : undefined
      }
      placeholder={placeholder}
      sent={sent}
      onSend={onSend}
      onEditQueued={onEditQueued}
      // A thread not made yet opens itself once its first message is in.
      onNextThread={chat ? () => void runCommand("new", "") : undefined}
      onStop={
        compacting
          ? undefined
          : (steers) => {
              if (chat)
                void api.cancelProjectChat(chat.id, { steers }).catch(setError);
            }
      }
      onCommand={runCommand}
      commandOptions={commandOptions}
    />
  );
}
