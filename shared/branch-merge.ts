import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{40,64}$/);
const branchName = z.string().min(1).max(250);

/** What merging the current branch into `base` would do, for the confirm dialog. */
export interface MergePlan {
  branch: string;
  head: string;
  base: string;
  baseHead: string;
  /** Local branches it can merge into, the default first. */
  bases: string[];
  /** Commits on the branch that `base` lacks, newest first, at most 50. */
  commits: { sha: string; subject: string }[];
  fastForward: boolean;
  /** Where `base` pushes, like `origin/main`; null for a local-only branch. */
  pushTarget: string | null;
  /** Another folder has `base` checked out; it fast-forwards there, around its uncommitted edits. */
  checkedOutAt: string | null;
  /** Commits an older Relay worktree made of the checkout's uncommitted edits; merging lands those too. */
  snapshots: number;
  /** Uncommitted files, which stay in the checkout and aren't merged. */
  uncommitted: number;
}

export const mergeBranchSchema = z
  .object({
    branch: branchName,
    head: sha,
    base: branchName,
    baseHead: sha,
    push: z.boolean(),
  })
  .strict();
export type MergeBranch = z.infer<typeof mergeBranchSchema>;

export type MergeResult =
  | {
      merged: true;
      base: string;
      sha: string;
      fastForward: boolean;
      pushedTo: string | null;
    }
  | { merged: false; conflicts: string[] };
