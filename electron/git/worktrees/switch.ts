// A thread's worktree folder moving to another branch, and the branch it leaves.

import type { ChatWorktree } from "../../../shared/projects";
import { checkedOutAt, commitOf, git } from "./common";
import { forkOff } from "./create";

/**
 * Switches the worktree's folder to existing `branch`, which nothing else has
 * checked out, and says what the thread's worktree is from now on: the same
 * folder, carrying that branch on. Git refuses when edits in the folder
 * would be overwritten; the folder is left as it was.
 */
export async function switchWorktree(
  root: string,
  worktree: ChatWorktree & { path: string },
  branch: string,
): Promise<ChatWorktree> {
  await git(worktree.path, ["switch", "--quiet", "--", branch], 60000);
  const { tip, fork, from } = await forkOff(root, branch);
  return {
    path: worktree.path,
    branch,
    head: tip,
    start: fork,
    base: fork,
    ...(from ? { from } : {}),
    named: branch,
    existing: true,
    ...(worktree.setup ? { setup: worktree.setup } : {}),
    ...(worktree.portOffset !== undefined
      ? { portOffset: worktree.portOffset }
      : {}),
  };
}

/**
 * Deletes the branch Relay made for `worktree` once it's left with no
 * commit of its own, no folder has it checked out and another ref still
 * holds where it is: nothing would be lost, and it would only crowd the
 * branch lists. Run in the repository's queue, so no thread carries it on
 * meanwhile.
 */
export async function dropUnusedBranch(root: string, worktree: ChatWorktree) {
  const { branch, head } = worktree;
  if (!branch || !head || worktree.existing || worktree.adopted) return;
  if (await checkedOutAt(root, branch)) return;
  if ((await commitOf(root, `refs/heads/${branch}`)) !== head) return;
  if (!(await heldElsewhere(root, head, branch))) return;
  await git(root, ["branch", "-D", branch]).catch(() => {});
}

/** Another branch, remote branch or tag contains `commit`, besides `branch`. */
async function heldElsewhere(root: string, commit: string, branch: string) {
  const refs = await git(root, [
    "for-each-ref",
    "--format=%(refname)",
    "--contains",
    commit,
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ]);
  return refs.split("\n").some((ref) => ref && ref !== `refs/heads/${branch}`);
}
