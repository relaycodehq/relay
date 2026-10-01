import type { TurnFileChange } from "./messages";

/** A thread that works in its own git worktree, leaving the checkout alone. */
export interface ChatWorktree {
  /** Unset until the first message makes the worktree. */
  path?: string;
  branch?: string;
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
}
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
}
/** Every uncommitted edit in the project folder, with the other threads whose turns changed each. */
export interface WorktreeMove {
  blocked?: string;
  files: (TurnFileChange & { threads?: string[] })[];
}
