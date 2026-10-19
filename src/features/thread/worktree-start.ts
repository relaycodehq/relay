import { localTwin, type BranchList } from "../../../shared/branches";
import type { WorktreeStart } from "../../../shared/projects";

/** The branches a new worktree can start off: every local one, and the remote ones that share history. */
export const branchOffNames = (list: BranchList) =>
  list.branches.filter((b) => !b.unrelated).map((b) => b.name);

/**
 * The branches a new worktree can carry on: local ones no folder has checked
 * out, Git allowing a branch in one place only, nor another thread keeps for
 * its worktree, and remote ones with no local branch yet, which get one
 * tracking them.
 */
export const carryOnNames = (
  list: BranchList,
  held: (branch: string) => boolean = () => false,
) =>
  list.branches
    .filter((b) =>
      b.remote
        ? !b.unrelated && !localTwin(list.branches, b)
        : !b.worktree && !b.current && !held(b.name),
    )
    .map((b) => b.name);

/** The branch a worktree that carries `start` on works on. */
export const carriedBranch = (
  start: WorktreeStart | undefined,
  list?: BranchList,
) =>
  start && "on" in start
    ? (list?.branches.find((b) => b.name === start.on)?.local ?? start.on)
    : undefined;
