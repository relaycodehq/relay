import { z } from "zod";
export interface BranchRef {
  name: string;
  ref: string;
  current: boolean;
  remote: boolean;
  worktree: boolean;
  /** On a remote whose history shares nothing with HEAD, so no use as a base. */
  unrelated: boolean;
}
export interface BranchList {
  current: string;
  head: string;
  branches: BranchRef[];
  /** Names work usually merges into, most likely first; see `baseCandidates`. */
  bases: string[];
}
/**
 * Where a branch stands against the bases. Kept apart from `BranchList`
 * because counting walks history, which on a big repository without a
 * commit-graph takes a good part of a second; only pickers that show it ask.
 */
export interface BranchCount {
  sha: string;
  /** Its last commit's committer date, in ms. */
  date: number;
  /**
   * Commits it has that its closest base lacks, and the reverse. Git before
   * 2.41 can't count: there it's 0 for a branch a base merged, else unknown.
   */
  ahead?: number;
  behind?: number;
  /** That closest base, of `BranchCounts.compared`. */
  against?: string;
  /** A worktree's branch nothing was committed to yet, rather than one that was merged. */
  noCommits?: boolean;
}
export interface BranchCounts {
  /** The bases that exist, locally or on origin, which the counts are against. */
  compared: string[];
  /** By branch name, as in `BranchRef.name`. */
  branches: Record<string, BranchCount>;
}
export const branchActionSchema = z
  .object({
    kind: z.enum(["switch", "create"]),
    name: z.string().min(1).max(250),
    current: z.string().max(250),
    head: z.string().regex(/^[a-f0-9]{40,64}$/),
  })
  .strict();
export type BranchAction = z.infer<typeof branchActionSchema>;
/** The local branch checking out remote `b` would land on, if it exists. */
export function localTwin(list: BranchRef[], b: BranchRef) {
  if (!b.remote) return undefined;
  const name = b.name.slice(b.name.indexOf("/") + 1);
  return list.find((l) => !l.remote && l.name === name);
}
