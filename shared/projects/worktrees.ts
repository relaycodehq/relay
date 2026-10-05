import type { TurnFileChange } from "./messages";

/** A thread that works in its own git worktree, leaving the checkout alone. */
export interface ChatWorktree {
  /** Unset until the first message makes the worktree. */
  path?: string;
  branch?: string;
  /**
   * A branch name kept rather than taken from its folder: the one the user
   * gave it, made with the first message, or the one it had on the computer
   * it came from. Relay still counts the branch as its own.
   */
  named?: string;
  /**
   * The branch the user named that couldn't be made by the time the first
   * message sent, and why; the worktree went on a `relay/…` branch instead.
   */
  wanted?: { branch: string; problem: string };
  /** The checkout's branch it was made from; its changes are what that branch lacks. */
  from?: string;
  /** The checkout's commit when the worktree was made. */
  head?: string;
  /** Where its branch starts: `head`, or for older worktrees a snapshot of the checkout's uncommitted edits. */
  start?: string;
  /** Older worktrees count their changes from here instead of from `from`. */
  base?: string;
  /** Its PR was merged on the Git host. Older worktrees may hold other values. */
  landed?: { at: number; by: string };
  pr?: { number: number; url: string };
  /** Removed; the next message makes a fresh one from the checkout. */
  removedAt?: number;
  /**
   * Removed by itself a while after the thread settled, with nothing
   * uncommitted in it. Its branch stays, and the next message checks it out again.
   */
  cleanedUp?: true;
}
/**
 * Days a settled thread keeps its worktree before Relay removes it; 0 as soon
 * as nothing is going on in it, null never. Off until asked for: removing a
 * folder also takes what Git ignores in it, like a hand-copied `.env`.
 */
export const DEFAULT_WORKTREE_CLEANUP_DAYS: number | null = null;
export interface AgentWorktree {
  path: string;
  branch?: string;
  /** When Relay first saw it. */
  at: number;
}
export interface WorktreeStatus {
  branch?: string;
  path?: string;
  /** The branch it merges into. */
  from?: string;
  /** What it has that `from` doesn't yet, committed or not. */
  files: TurnFileChange[];
  /** Everything it committed is in `from` now, or its PR was merged. */
  landed?: { by: "merge" | "pr" };
  pr?: ChatWorktree["pr"];
  removed: boolean;
  /** Removed after the thread settled, its branch kept; see `ChatWorktree.cleanedUp`. */
  cleanedUp?: true;
}
/** The branch a new thread's worktree would be made on, and why it can't, if it can't. */
export interface WorktreeBranch {
  branch: string;
  problem?: string;
}
/** Every uncommitted edit in the project folder, with the other threads whose turns changed each. */
export interface WorktreeMove {
  blocked?: string;
  files: (TurnFileChange & { threads?: string[] })[];
}
