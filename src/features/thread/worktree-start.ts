import { localTwin, type BranchList } from "../../../shared/branches";
import type { WorktreeStart } from "../../../shared/projects";

/** The branches a new thread's branch control lists: every local one, and the remote ones that share history. */
export const branchOffNames = (list: BranchList) =>
  list.branches.filter((b) => !b.unrelated).map((b) => b.name);

/** The branch a worktree that carries `start` on works on. */
export const carriedBranch = (
  start: WorktreeStart | undefined,
  list?: BranchList,
) =>
  start && "on" in start
    ? (list?.branches.find((b) => b.name === start.on)?.local ?? start.on)
    : undefined;

/**
 * What the new thread's branch control is about: the checkout's branch, the
 * branch a worktree works on (`start` is `{on}`), or a new worktree's base.
 */
export type BranchMode = "checkout" | "on" | "off";

/** What picking a branch in the new thread's branch control does. */
export type BranchPick =
  | { kind: "stay" }
  /** Switch the checkout to it, as its own picker does. */
  | { kind: "switch" }
  /** Back to working in the checkout, which is on it already. */
  | { kind: "checkout" }
  /** Work in a worktree; `busy` when that's only because the checkout couldn't switch. */
  | { kind: "worktree"; start: WorktreeStart | undefined; busy?: true };

/**
 * Picking `name` means working on it, wherever that can be: in the checkout
 * when it's there or can switch to it, else in its worktree, joined or made.
 * Nothing is refused; `locked` (or a refused switch) only moves it to a worktree.
 */
export function pickBranch({
  mode,
  name,
  list,
  checkout,
  locked,
}: {
  mode: BranchMode;
  name: string;
  list?: BranchList;
  /** The checkout's branch; null when its HEAD is detached. */
  checkout?: string | null;
  locked: boolean;
}): BranchPick {
  if (mode === "off")
    return {
      kind: "worktree",
      start: name === checkout ? undefined : { off: name },
    };
  const picked = list?.branches.find((b) => b.name === name);
  // A remote one whose local branch exists means that branch, as `git switch` has it.
  const own = (picked && list && localTwin(list.branches, picked)) ?? picked;
  const onCheckout = own ? own.current : name === checkout;
  const on = { on: own?.name ?? name };
  if (mode === "on")
    return onCheckout ? { kind: "checkout" } : { kind: "worktree", start: on };
  if (onCheckout) return { kind: "stay" };
  if (own?.worktree) return { kind: "worktree", start: on };
  if (locked) return { kind: "worktree", start: on, busy: true };
  return { kind: "switch" };
}

// How Git says edits in the checkout would be overwritten by switching.
const overwritten = /local changes|untracked working tree files|uncommitted/i;

/**
 * The note under the composer when a branch picked for the checkout got a
 * worktree instead, saying why from the reason the checkout gave: edits Git
 * won't carry over, or anything else that held it.
 */
export function detourLine(
  reason: string,
  outcome: { carried: string } | { made: string },
) {
  const cause = overwritten.test(reason)
    ? "has uncommitted changes"
    : "is busy";
  return `Your checkout ${cause}, so this thread ${
    "carried" in outcome
      ? `gets its own worktree on ${outcome.carried}.`
      : `makes ${outcome.made} in a new worktree.`
  }`;
}
