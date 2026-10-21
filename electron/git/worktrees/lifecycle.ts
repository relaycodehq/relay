import { readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { commitTree, snapshotTree } from "../turn-changes";
import type { ChatWorktree } from "../../../shared/projects";
import { errorMessage } from "../../../shared/error-message";
import { bootstrap } from "./bootstrap";
import {
  git,
  keptRef,
  exists,
  hasBranch,
  relayBranch,
  carryOnProblem,
  checkoutHead,
} from "./common";
import { freeName } from "./naming";

// Taking a thread's worktree back after a restart, recreating and removing it.

/**
 * Brings back a worktree removed with its branch kept, at its old folder:
 * the branch as it was when it holds commits the checkout lacks, so the
 * thread carries on where it stopped; otherwise the branch moves up to the
 * checkout's commit, like a fresh worktree, unless it started off another
 * branch. Undefined when it can't: the branch is gone, its folder is taken,
 * or it's checked out elsewhere. A
 * branch the thread carried on takes a free folder beside its old one, and
 * one that can't be opened throws why, as it's never swapped for another.
 */
export async function reattachWorktree(
  root: string,
  previous: ChatWorktree,
): Promise<ChatWorktree | undefined> {
  const { branch, existing } = previous;
  let path = previous.path;
  if (!path || !branch || !relayBranch(previous)) return undefined;
  if (await exists(path)) {
    if (!existing) return undefined;
    path = join(
      dirname(path),
      await freeName(root, dirname(path), basename(path), branch),
    );
  }
  const kept = await git(root, [
    "rev-parse",
    "-q",
    "--verify",
    `refs/heads/${branch}^{commit}`,
  ]).then(
    () => true,
    () => false,
  );
  if (!kept) return undefined;
  const head = await checkoutHead(root);
  const ahead = Number(
    await git(root, ["rev-list", "--count", `${head}..refs/heads/${branch}`]),
  );
  // The checkout's commit isn't where one carried on or started off belongs.
  const stays = ahead || existing || previous.startedOff;
  await git(root, ["worktree", "prune"]).catch(() => {});
  try {
    if (stays) await git(root, ["worktree", "add", "-q", path, branch], 120000);
    // Everything on it is in the checkout's commit, so moving it loses nothing.
    else
      await git(
        root,
        ["worktree", "add", "-q", "-B", branch, path, head],
        120000,
      );
  } catch (error) {
    if (!existing) return undefined;
    const why = (await carryOnProblem(root, branch)) ?? errorMessage(error);
    throw new Error(`Couldn't open ${branch} in a worktree again: ${why}`);
  }
  // A fresh folder: its ignored files and setup are gone with the old one.
  const ready = await bootstrap(root, root, path);
  const {
    removedAt: _removed,
    cleanedUp: _cleaned,
    included: _included,
    // Free since removal, so maybe handed on; setup gives it a new one.
    portOffset: _offset,
    ...rest
  } = previous;
  if (stays) return { ...rest, path, ...ready };
  const from = (await git(root, ["branch", "--show-current"])).trim();
  return {
    path,
    branch,
    head,
    start: head,
    base: head,
    ...(from ? { from } : {}),
    ...(previous.named ? { named: previous.named } : {}),
    ...ready,
  };
}

/** Whether a deleted agent worktree's branch is still there to make it again from. */
export const branchKept = (root: string, branch: string) =>
  hasBranch(root, branch);

/**
 * Makes an agent's deleted worktree again in its old folder, on its branch,
 * with the `.worktreeinclude` files and `node_modules` a thread's own gets.
 * What it held uncommitted went with the folder.
 */
export async function recreateWorktree(
  root: string,
  path: string,
  branch: string,
) {
  if (!(await hasBranch(root, branch)))
    throw new Error(`Its branch ${branch} was deleted too.`);
  if (await exists(path)) throw new Error(`Something else is in ${path} now.`);
  await git(root, ["worktree", "prune"]).catch(() => {});
  await git(root, ["worktree", "add", "-q", path, branch], 120000);
  await bootstrap(root, root, path);
  const file = await readFile(join(path, ".git"), "utf8").catch(() => "");
  const gitdir = file.match(/^gitdir: (.+)$/m)?.[1];
  return {
    path,
    branch,
    ...(gitdir ? { gitdir: basename(gitdir.trim()) } : {}),
  };
}

/**
 * Removes the worktree, keeping a snapshot of what it held, and its branch
 * too unless `keepBranch` or the branch was there before the thread. A
 * folder Relay didn't make stays.
 */
export async function removeWorktree(
  root: string,
  chatId: string,
  worktree: ChatWorktree,
  { keepBranch = false } = {},
) {
  // Never Relay's to take, whoever asks.
  if (worktree.adopted) return;
  if (worktree.path && (await exists(worktree.path))) {
    const tree = await snapshotTree(worktree.path).catch(() => null);
    if (tree) {
      const kept = await commitTree(
        root,
        tree,
        worktree.base,
        "Relay: the worktree as it was removed",
      );
      await git(root, ["update-ref", keptRef(chatId), kept]);
    }
    await git(root, ["worktree", "remove", "--force", worktree.path]).catch(
      async () => {
        await rm(worktree.path!, { recursive: true, force: true });
        await git(root, ["worktree", "prune"]).catch(() => {});
      },
    );
  }
  if (worktree.branch && !keepBranch && !worktree.existing)
    await git(root, ["branch", "-D", worktree.branch]).catch(() => {});
}
