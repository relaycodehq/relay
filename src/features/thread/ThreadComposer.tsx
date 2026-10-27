import { useCallback, useMemo, useRef, type ReactNode, type Ref } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { agentName } from "../../../shared/agents";
import type { CommandOption, RelayCommand } from "../../../shared/commands";
import type { ComposedSend } from "../../../shared/compose-send";
import { latestContextReport } from "../../../shared/context-report";
import { openPlan } from "../../../shared/open-plan";
import type {
  ChatMessage,
  ChatScope,
  Project,
} from "../../../shared/projects";
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
import { worthCompactingCold } from "../../../shared/context-usage";
import { awayPlaceholder } from "../handoff/HandoffStrip";
import { SetupLine } from "../handoff/SetupLine";
import { inSetup, liveAway } from "../../../shared/handoff";
import {
  ProjectComposer,
  type ComposerHandle,
} from "../composer/ProjectComposer";
import { sentHistory } from "../composer/prompt-history";
import { SubagentsIndicator } from "../agent-turn/Subagents";
import { StartedChip } from "../agent-turn/StartedChip";
import { ThreadNotice } from "./ThreadNotice";
import { IconButton } from "../../ui/ui";
import { StartedThreadBranch } from "./StartedThreadBranch";
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
 * The branch the thread works on. Picking one says where it works: before
 * the first message for the thread to start there, after it to move there.
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
  // The deleted worktree's row asks where to carry on; its branch name would be stale.
  if (worktree.unavailable) return null;
  // Its name comes with the thread's title, a moment after sending.
  if (worktree.naming) return null;
  return (
    <StartedThreadBranch
      project={project}
      worktree={worktree}
      checkout={checkout}
      disabled={disabled}
      onStartThread={onStartThread}
    />
  );
}

/**
 * Compacting first, offered by Send when a message now would find a big
 * conversation's prompt cache cold. Main's firstIfCold makes the same call.
 */
function offerToCompact({
  chat,
  root,
  saved,
  shown,
  context,
  compacting,
}: {
  chat: ThreadHandle["chat"];
  root: ChatThread["root"];
  saved: ChatThread["history"]["data"];
  shown: ChatMessage[];
  context: SessionCommands["context"];
  compacting: boolean;
}) {
  if (!chat || !context || compacting) return undefined;
  const sideQuestion = !!root?.side;
  // The computer it's handed to may not know `compact`.
  const handedOff = !!chat.sentTo;
  // Compacting first would jump ahead of messages already queued.
  const queueWaiting = !!saved?.queue?.length || !!saved?.queuePaused;
  // Compacting resumes the session of the agent that answered last.
  const lastAnswerer = shown.findLast((m) => m.role === "assistant")?.provider;
  const sessions = root ? saved?.replySessions?.[root.id] : saved?.sessions;
  const canResume =
    lastAnswerer === context.provider && !!sessions?.[context.provider]?.thread;
  if (sideQuestion || handedOff || queueWaiting || !canResume) return undefined;
  if (!worthCompactingCold(context.usage, Date.now())) return undefined;
  return { provider: context.provider, tokens: context.usage.usedTokens };
}

/** What the empty composer says: where the thread is, or what's going on in it. */
function composerPlaceholder({
  chat,
  root,
  reviewing,
  running,
  pending,
  scratch,
}: {
  chat: ThreadHandle["chat"];
  root: ChatThread["root"];
  reviewing: boolean;
  running: boolean;
  pending: BackgroundWork["pending"];
  scratch: boolean;
}) {
  const away = chat && awayPlaceholder(chat);
  if (away) return away;
  if (root?.side)
    return `Ask ${agentName(root.provider)} a follow-up on the side…`;
  if (reviewing) return "Reviewers are at work. Messages wait for the lead…";
  if (!running && pending?.some((p) => p.kind === "task"))
    return "Message Claude, its background work keeps going…";
  if (!running && pending)
    return "Message Claude now, or wait for it to check back…";
  if (scratch) return "Ask anything…";
  return undefined;
}

/** The guess the last answer left, while it is the last word and wasn't put away. */
function nextGuess(view: ChatMessage[]) {
  const last = view.at(-1);
  return last?.role === "assistant" &&
    last.status === "complete" &&
    last.prediction &&
    last.predictionSeen !== "dismissed"
    ? {
        id: last.id,
        text: last.prediction,
        seen: last.predictionSeen === "shown",
      }
    : undefined;
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
  // Off, a guess the last answer already has isn't offered either.
  const predictions = useQuery({
    queryKey: ["composer-predictions"],
    queryFn: () => api.composerPredictions(),
  });
  const savedReport = useMemo(() => latestContextReport(shown), [shown]);
  const cost = useMemo(() => threadCost(shown), [shown]);
  const cacheExpired = useCacheExpired(context?.usage.cache);
  // useCacheExpired renders again once the cache runs out.
  const compactOffer = cacheExpired
    ? offerToCompact({
        chat,
        root,
        saved: history.data,
        shown,
        context,
        compacting,
      })
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
  // While a thread handed to another computer waits on its setup, the
  // composer talks to the setup's agent: its answer is what runs.
  const setup = chat && inSetup(chat) ? history.data?.setup : undefined;
  const setupRunning = !!setup?.messages.some((m) => m.status === "streaming");
  // A /btw side question doesn't wait or queue behind the main answer, and
  // the thread's Stop isn't for it.
  const answerComing =
    !root?.side && (mainRunning || reviewing || setupRunning);
  const loading = !!chat && history.isPending;
  // On another computer and not followed live from here.
  const awayElsewhere = !!chat?.sentTo && !liveAway(chat) && !inSetup(chat);
  // Handed back to the computer it came from.
  const handedBack = !!chat?.cameFrom?.returnedAt;
  const sendBlocked =
    busy || loading || worktree.unavailable || awayElsewhere || handedBack;
  // Read on ↑ only, so streaming answers don't rebuild it.
  const shownNow = useRef(shown);
  shownNow.current = shown;
  const sent = useCallback(() => sentHistory(shownNow.current), []);
  const placeholder = composerPlaceholder({
    chat,
    root,
    reviewing,
    running,
    pending,
    scratch: !!project.scratch,
  });
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
        running: answerComing,
        busy: sendBlocked,
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
        prediction:
          running || root || !predictions.data ? undefined : nextGuess(shown),
        chatId: chat?.id,
        accounts: chat?.accounts,
        compactOffer,
      }}
      context={
        <>
          {scopeButtons}
          {notesChip}
          <StartedChip />
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
            disabled={answerComing || sendBlocked}
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
