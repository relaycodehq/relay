import { agentsSince } from "../../shared/waiting";
import type {
  ChatScope,
  ChatSummary,
  ChatWorkspace,
} from "../../shared/projects";

const WORKTREE_PENDING =
  "The terminal opens in this thread's worktree, which its first message makes";

/** The thread while it works in a worktree on disk; otherwise its folder is the project's checkout. */
export const worktreeThread = (chat: ChatSummary | undefined) =>
  !!chat?.worktree?.path && !chat.worktree.removedAt ? chat : undefined;

/**
 * Whether an agent is at work in the folder `inWorktree` (a worktree thread,
 * or the checkout without one). Another thread's worktree doesn't touch it.
 */
export const agentWorkingIn = (
  chats: ChatSummary[] | undefined,
  inWorktree: ChatSummary | undefined,
) =>
  !!chats?.some(
    (c) =>
      (c.running || agentsSince(c.pending) !== undefined) &&
      worktreeThread(c)?.id === inWorktree?.id,
  );

/**
 * Why the thread's terminal can't open, if it can't. It works where the
 * thread's files are: a worktree thread has none until its first message
 * makes the worktree. `draftWorkspace` is where the unsent thread will work.
 */
export function terminalBlocked(
  chat: ChatSummary | undefined,
  scope: ChatScope,
  draftWorkspace: ChatWorkspace,
) {
  return chat?.worktree
    ? chat.worktree.removedAt
      ? "This thread's worktree was removed. Its next message makes a new one"
      : !chat.worktree.path
        ? WORKTREE_PENDING
        : undefined
    : !chat && scope.kind === "project" && draftWorkspace === "worktree"
      ? WORKTREE_PENDING
      : undefined;
}
