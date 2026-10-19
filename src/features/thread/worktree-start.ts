import { localTwin, type BranchList } from "../../../shared/branches";
import type { WorktreeStart } from "../../../shared/projects";

/** A remote branch's name without its remote, as the local one tracking it would be called. */
export const withoutRemote = (name: string) =>
  name.slice(name.indexOf("/") + 1);

/** The branches a new worktree can start off: every local one, and the remote ones that share history. */
export const branchOffNames = (list: BranchList) =>
  list.branches.filter((b) => !b.unrelated).map((b) => b.name);

/**
 * The branches a new worktree can carry on: local ones no folder has checked
 * out, Git allowing a branch in one place only, and remote ones with no
 * local branch yet, which get one tracking them.
 */
export const carryOnNames = (list: BranchList) =>
  list.branches
    .filter((b) =>
      b.remote
        ? !b.unrelated && !localTwin(list.branches, b)
        : !b.worktree && !b.current,
    )
    .map((b) => b.name);

/** The branch a worktree that carries `start` on works on. */
export const carriedBranch = (
  start: WorktreeStart | undefined,
  list?: BranchList,
) =>
  start && "on" in start
    ? list?.branches.find((b) => b.name === start.on)?.remote
      ? withoutRemote(start.on)
      : start.on
    : undefined;
