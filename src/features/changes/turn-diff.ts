import type { TurnFileChange, WorktreeStatus } from "../../../shared/projects";

export type TurnDiffTarget = {
  chatId: string;
  messageId: string;
  files: TurnFileChange[];
  path?: string;
  /** Who answered and when, e.g. "Claude · 12:04". */
  label: string;
  /** Everything the thread's worktree has that the branch it came from doesn't yet. */
  worktree?: boolean;
};

/** Everything the worktree has that the branch it came from doesn't, opened at `path`. */
export function worktreeDiff(
  chatId: string,
  status: WorktreeStatus,
  path?: string,
): TurnDiffTarget {
  return {
    chatId,
    messageId: "worktree",
    files: status.files,
    path,
    label: status.branch ?? "Worktree",
    worktree: true,
  };
}
