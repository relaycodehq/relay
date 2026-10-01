import type { ReactNode, Ref } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { agentName } from "../../shared/agents";
import type { ComposedSend } from "../../shared/compose-send";
import type { ChatScope, ChatSummary, Project } from "../../shared/projects";
import { threadContextAgent } from "../../shared/recipient";
import { api } from "../lib/api";
import { writeDraft } from "../lib/drafts";
import { threadDraftKey } from "../lib/thread-storage";
import type { TurnDiffTarget } from "../lib/turn-diff";
import type { BackgroundWork } from "../lib/useBackgroundWork";
import type { ChatThread } from "../lib/useChatThread";
import type { ComposerAttachments } from "../lib/useComposerAttachments";
import type { Councils } from "../lib/useCouncils";
import type { SessionCommands } from "../lib/useSessionCommands";
import type { ThreadHandle } from "../lib/useThreadHandle";
import type { ThreadWorktree } from "../lib/useThreadWorktree";
import { CodeReferenceList } from "./CodeReferenceChip";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { awayPlaceholder } from "./HandoffStrip";
import { ProjectComposer, type ComposerHandle } from "./ProjectComposer";
import { SubagentsIndicator } from "./Subagents";
import { ThreadNotice } from "./ThreadNotice";
import { IconButton } from "./ui";
import { WorkItemChip } from "./WorkItemCards";
import { WorkspaceControl } from "./WorktreeControls";

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

/**
 * The open conversation's composer, told what the thread is doing: whether
 * its agents are at work, what it waits on, where it works, and what the
 * agent's session holds.
 */
export function ThreadComposer({
  chat,
  threadId,
  project,
  scope,
  handleRef,
  thread: { root, shown, running },
  handle: { busy, setError },
  councils: { reviewing, planning },
  background: { agentBatch, pending, stopped, leftBehind },
  session: { runCommand, context, compacting, showContext, compact },
  attachments,
  worktree,
  branch,
  checkoutDisabled,
  scopeButtons,
  onSend,
  onStartThread,
  onOpenAgent,
  onOpenTurnDiff,
}: {
  chat?: ChatSummary;
  /** The thread's id, or its draft's before the first message. */
  threadId: string;
  project: Project;
  scope: ChatScope;
  handleRef: Ref<ComposerHandle>;
  thread: ChatThread;
  handle: ThreadHandle;
  councils: Councils;
  background: BackgroundWork;
  session: SessionCommands;
  attachments: ComposerAttachments;
  worktree: ThreadWorktree;
  /** The project checkout's branch. */
  branch?: string | null;
  checkoutDisabled: boolean;
  scopeButtons: ReactNode;
  onSend: (value: ComposedSend, dispatch?: () => void) => Promise<boolean>;
  /** Opens a new project-folder thread on `text`, sent or as a draft. */
  onStartThread?: (text: string, send: boolean) => Promise<void>;
  /** Opens a subagent's run as a side thread. */
  onOpenAgent: (id: string) => void;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
}) {
  const qc = useQueryClient();
  const draftKey = threadDraftKey(threadId, root?.id);
  const { selection, workItem, codeRefs } = attachments;
  const placeholder =
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
                : undefined);
  return (
    <ProjectComposer
      handleRef={handleRef}
      onCommand={runCommand}
      // A side conversation keeps its own agent and opens on the one that wrote its message.
      settingsKey={root ? `${threadId}:${root.id}` : threadId}
      inherit={
        root
          ? {
              settingsKey: threadId,
              provider:
                root.role === "assistant" || root.side
                  ? root.provider
                  : undefined,
            }
          : undefined
      }
      agent={chat && threadContextAgent(chat)}
      draftKey={draftKey}
      onDraft={(v) => writeDraft(draftKey, v)}
      shared={!!chat?.shared}
      // A side thread doesn't wait for the main answer, nor queue behind it.
      running={root?.side ? false : running || reviewing || planning}
      busy={busy || !!chat?.sentTo || !!chat?.cameFrom?.returnedAt}
      branch={branch}
      plain={project.plain}
      projectId={project.id}
      checkoutDisabled={checkoutDisabled}
      onStartThread={onStartThread}
      workspace={
        <>
          {agentBatch.length > 0 && (
            <SubagentsIndicator
              batch={agentBatch}
              projectRoot={worktree.folder}
              onOpen={onOpenAgent}
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
          {scope.kind !== "project" || project.plain ? undefined : (
            <WorkspaceControl
              chat={chat}
              worktree={worktree}
              running={running}
              busy={busy}
              onOpenTurnDiff={onOpenTurnDiff}
              onError={setError}
            />
          )}
        </>
      }
      branchLabel={worktree.branch}
      onSend={onSend}
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
      placeholder={placeholder}
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
          <AttachedContext attachments={attachments} />
        ) : undefined
      }
    />
  );
}
