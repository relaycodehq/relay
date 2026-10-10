import { Fragment, useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { unreadStart } from "../../../shared/chat-activity";
import { latestSetup } from "../../../shared/worktree-command";
import { reviewReports } from "../../../shared/deep-review";
import { api } from "../../lib/api";
import type {
  ChatMessage,
  ProjectChat as ProjectChatData,
} from "../../../shared/projects";
import { useArrival } from "./arrival";
import type { ChatThread } from "./useChatThread";
import type { Councils } from "./useCouncils";
import type { ThreadMessageActions } from "./useMessageActions";
import type { QueuedMessageActions } from "./useQueuedMessages";
import type { ThreadHandle } from "./useThreadHandle";
import type { ThreadScroll } from "./useThreadScroll";
import type { ThreadWorktree } from "./useThreadWorktree";
import {
  DeepReviewCouncil,
  DeepReviewReport,
  DeepReviewRequest,
  findingCode,
} from "../deep-review/DeepReview";
import { Message } from "./ProjectMessage";
import { QueuedMessages } from "./QueuedMessages";
import { SideQuestion } from "./SideQuestion";
import { UnreadDivider, UnreadMark } from "./UnreadDivider";
import { ErrorBox, Loading } from "../../ui/ui";
import { UltraplanCouncil } from "../deep-review/council/Ultraplan";
import { WorktreeLanded, WorktreeRenamed } from "./WorktreeControls";
import { TerminalOrigin } from "../continue-session/TerminalOrigin";

const isAnswer = (m: ChatMessage) =>
  m.role === "assistant" &&
  !m.compaction &&
  !m.handoff &&
  !m.reload &&
  !m.worktreeCommand;

/** The open conversation's last answer was cut short, and the input it
 * answered belongs to this conversation, so it can go again. */
function resumable(
  listed: ChatMessage[],
  lastInput: ProjectChatData["lastInput"],
  rootId: string | null,
) {
  const last = listed.filter(isAnswer).at(-1);
  return (
    !!last &&
    ["cancelled", "failed"].includes(last.status) &&
    !!lastInput &&
    (lastInput.parentId ?? null) === rootId
  );
}

/**
 * The thread's scrolling view: its messages with their councils and side
 * questions, then what's still to come, queued or ready to resume.
 */
export function ThreadMessages({
  handle: { chat, busy },
  projectPath,
  thread: {
    history,
    messages,
    root,
    shown,
    listed,
    running,
    replyCounts,
    sideThreads,
    leadAnswered,
  },
  view: { scroll, column, onScroll, visible, earlier, showEarlier, dockHeight },
  councils: {
    review,
    plans,
    fixFindings,
    setFindingStatus,
    resumeReview,
    resumeUltraplan,
  },
  actions: {
    signIn,
    openReply,
    forkThread,
    openChanges,
    openFile,
    openTurnDiff,
    rewindTurn,
  },
  queue: { steer, move, returnToComposer },
  worktree,
  onResume,
  onSteer,
}: {
  handle: ThreadHandle;
  projectPath: string;
  thread: ChatThread;
  /** Where the view's refs and scroll handler land. */
  view: ThreadScroll;
  councils: Councils;
  actions: ThreadMessageActions;
  queue: QueuedMessageActions;
  worktree: ThreadWorktree;
  /** Sends the cut-short answer's input again. */
  onResume: () => void;
  /** Puts a message for the agent in the composer. */
  onSteer: (text: string) => void;
}) {
  // Keyed on the report alone: a new renderer redraws the whole summary, and
  // the review changes with every finding dismissed or fixed.
  const reviewCode = useMemo(
    () =>
      chat && review
        ? findingCode(
            chat.id,
            reviewReports(review).flatMap((r) => r.findings),
          )
        : undefined,
    [chat?.id, review?.report, review?.reports],
  );
  // Said once, under the message that made the worktree.
  const renamedAfter =
    !root && chat?.worktree?.wanted
      ? listed.find((m) => m.role === "user" && !m.parentId)?.id
      : undefined;
  const arrival = useArrival(chat?.id);
  const unread = useMemo(
    () => (arrival && !root ? unreadStart(listed, arrival.away) : undefined),
    [arrival, root, listed],
  );
  const unreadProps = unread && {
    chatId: arrival!.chatId,
    since: unread.since,
    read: arrival!.read,
    scroll,
    bottomInset: dockHeight,
  };
  const setupId = useMemo(
    () => (root ? undefined : latestSetup(listed)?.id),
    [root, listed],
  );
  return (
    <div className="project-messages" ref={scroll} onScroll={onScroll}>
      {chat && history.isPending && <Loading text="Opening conversation…" />}
      {history.error && (
        <ErrorBox error={history.error} retry={() => void history.refetch()} />
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
        {listed.slice(-visible).flatMap((m) => [
          m.id === unread?.id && !m.handoff && (
            <UnreadDivider key="unread-divider" {...unreadProps!} />
          ),
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
                projectRoot={projectPath}
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
              projectRoot={worktree.folder}
              onOpenFile={openFile}
              replyCount={root ? 0 : (replyCounts.get(m.id) ?? 0)}
              onSignIn={
                m.signIn && m.id === listed.at(-1)?.id ? signIn : undefined
              }
              onSteer={root?.side ? undefined : onSteer}
              unread={
                m.id === unread?.id && m.handoff ? (
                  <UnreadMark {...unreadProps!} />
                ) : undefined
              }
              onRerunSetup={
                // Setup changes files the running answer may be using.
                chat && !busy && !running && m.id === setupId
                  ? () => api.rerunWorktreeSetup(chat.id, m.id)
                  : undefined
              }
              {...(chat &&
              review &&
              reviewReports(review).some((r) => r.messageId === m.id)
                ? {
                    inlineCode: reviewCode,
                    after: (
                      <DeepReviewReport
                        chatId={chat.id}
                        state={review}
                        report={reviewReports(review).find(
                          (r) => r.messageId === m.id,
                        )}
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
                        projectRoot={worktree.folder}
                        onOpenFile={openFile}
                        onResume={() => resumeUltraplan(m.id)}
                      />
                    ),
                  }
                : {})}
            />
          ),
          m.id === renamedAfter && (
            <WorktreeRenamed
              key="worktree-renamed"
              worktree={chat!.worktree!}
            />
          ),
          !root && m.id === chat?.fromTerminal?.through && (
            <TerminalOrigin key="terminal-origin" from={chat.fromTerminal} />
          ),
        ])}
        {!root && worktree.status && (
          <WorktreeLanded status={worktree.status} />
        )}
        {!running &&
          resumable(listed, history.data?.lastInput, root?.id ?? null) && (
            <button
              className="resume-answer"
              disabled={busy}
              onClick={onResume}
            >
              <RotateCcw size={13} /> Resume answer
            </button>
          )}
        <QueuedMessages
          queue={history.data?.queue}
          paused={history.data?.queuePaused}
          scheduled={history.data?.scheduled}
          running={running}
          compacting={shown.some(
            (m) => m.compaction && m.status === "streaming",
          )}
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
  );
}
