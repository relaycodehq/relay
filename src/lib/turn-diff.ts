import type { TurnFileChange } from "../../shared/projects";

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
