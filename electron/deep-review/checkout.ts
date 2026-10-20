// Where a review of a branch or pull request that isn't checked out reads its
// files and fixes them: the folder the branch is already checked out in, or
// a worktree Relay makes for the review, on the branch whenever there is
// one. Reviewers open the reviewed code itself rather than the thread's
// checkout, and the thread's Git and file panes follow it there.
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { git, worktreeList } from "../git/git";
import { sameFolder } from "../git/worktrees";
import type { ReviewCheckout, ReviewScope } from "../../shared/deep-review";

/** The folder under Relay's worktrees that holds the ones made for reviews, named after their review thread. */
export const reviewCheckoutsIn = (worktrees: string) =>
  join(worktrees, "deep-reviews");

/** The review thread a folder there is for: its own, or one a fix made beside it, `<id>-2`. */
const ownerOf = (name: string) => name.replace(/-\d{1,3}$/, "");

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const isLocalBranch = (root: string, branch: string) =>
  git(root, ["rev-parse", "-q", "--verify", `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  );

const dirty = async (path: string) =>
  !!(await git(path, ["status", "--porcelain", "--untracked-files=normal"]));

/** The folder `branch` is checked out in, the main checkout among them, if any. */
async function folderOf(root: string, branch: string) {
  return (await worktreeList(root)).find(
    (w) => w.branch === branch && !w.prunable,
  )?.path;
}

/**
 * The local branch a pull request's fixes go on: its head branch, then
 * `pr/<number>`, the first that already holds the reviewed `head` or, when
 * `make`, that's free to make there. A branch of that name that doesn't
 * hold it is someone else's work and stays alone.
 */
async function pullBranch(
  root: string,
  pr: NonNullable<ReviewCheckout["pr"]>,
  head: string,
  make: boolean,
) {
  const names = [
    pr.head,
    `pr/${pr.number}`,
    `pr/${pr.number}-${head.slice(0, 7)}`,
  ];
  for (const name of names) {
    if (
      !name ||
      !(await git(root, ["check-ref-format", "--branch", name]).then(
        () => true,
        () => false,
      ))
    )
      continue;
    if (!(await isLocalBranch(root, name))) {
      if (make) return { branch: name, made: true };
      continue;
    }
    const holds = await git(root, [
      "merge-base",
      "--is-ancestor",
      head,
      `refs/heads/${name}`,
    ]).then(
      () => true,
      () => false,
    );
    if (holds) return { branch: name, made: false };
  }
}

/** The reviewed code isn't what the thread's checkout has: a pull request, or a branch other than its own. */
export function needsCheckout(scope: ReviewScope) {
  const t = scope.target;
  if (t.kind === "pr") return true;
  return t.kind === "branch" && (t.head ?? scope.branch) !== scope.branch;
}

/**
 * Makes the review's worktree on `branch` when no other folder has it, even
 * once the branch moved on past `head`: it's the branch the user wants
 * fixed, and the reviewed range stays the commits the review was asked
 * for. Detached at `head` only without a branch to be on.
 */
async function addWorktree(
  root: string,
  path: string,
  head: string,
  branch?: string,
) {
  await mkdir(dirname(path), { recursive: true });
  // A folder deleted by hand leaves Git's record of it behind.
  await git(root, ["worktree", "prune"]).catch(() => {});
  const onBranch = branch && !(await folderOf(root, branch));
  // Git lists folders by their real paths, which `path` needn't be.
  let left: Awaited<ReturnType<typeof worktreeList>>[number] | undefined;
  for (const w of await worktreeList(root))
    if (await sameFolder(w.path, path)) {
      left = w;
      break;
    }
  if (left?.prunable) {
    // Gone but locked, so the prune kept it; it was Relay's to make again.
    await git(root, ["worktree", "unlock", path]).catch(() => {});
    await git(root, ["worktree", "prune"]).catch(() => {});
  } else if (left) {
    // One a discard couldn't remove, a file held open or a lock on it, is
    // still this repository's worktree: taken back as it is.
    if (onBranch) await git(path, ["switch", "--quiet", branch], 60000);
    return;
  }
  await git(
    root,
    onBranch
      ? ["worktree", "add", "-q", path, branch]
      : ["worktree", "add", "-q", "--detach", path, head],
    120000,
  );
}

/**
 * Where the review reads the code `scope` covers. A branch already checked
 * out in a folder, clean or not, is reviewed there, so fixes land on it
 * with whatever else is going on in it; otherwise Relay makes a worktree in
 * `dir`, named after the review thread `chatId`, on the branch. A pull
 * request is the same when a local branch already holds its head, and
 * otherwise a detached copy to read, `prHead` being its head branch when
 * it's in the project's own repository, to name the branch a fix makes.
 * Undefined when the thread's checkout already has it. Nothing is copied in
 * and no setup runs: reviewers only read.
 */
export async function openReviewCheckout(
  root: string,
  scope: ReviewScope,
  dir: string,
  chatId: string,
  prHead?: string,
): Promise<ReviewCheckout | undefined> {
  if (!needsCheckout(scope) || !scope.head) return;
  const t = scope.target;
  const pr =
    t.kind === "pr"
      ? { number: t.ref.number, ...(prHead ? { head: prHead } : {}) }
      : undefined;
  const branch =
    t.kind === "branch"
      ? t.head && (await isLocalBranch(root, t.head))
        ? t.head
        : undefined
      : pr && (await pullBranch(root, pr, scope.head, false))?.branch;
  const about = { ...(branch ? { branch } : {}), ...(pr ? { pr } : {}) };
  const path = join(reviewCheckoutsIn(dir), chatId);
  if (branch) {
    const at = await folderOf(root, branch);
    if (at) {
      const made = await sameFolder(at, path);
      return { path: made ? path : at, made, ...about };
    }
  }
  await addWorktree(root, path, scope.head, branch);
  return { path, made: true, ...about };
}

/** The review's folder, made again at `head` when it was one Relay made and has since been cleaned up. */
export async function ensureReviewCheckout(
  root: string,
  checkout: ReviewCheckout,
  head: string,
) {
  if (await exists(checkout.path)) return checkout.path;
  if (!checkout.made)
    throw new Error(
      `The worktree this review reads from, ${checkout.path}, is gone.`,
    );
  await addWorktree(root, checkout.path, head, checkout.branch);
  return checkout.path;
}

/**
 * Where the review works from here on, so what it changes lands on the
 * reviewed branch: the folder the branch is checked out in now, wherever
 * that is, or else the review's own worktree in `dir`, switched to the
 * branch or made on it. A pull request with no local branch gets one when
 * `fixing`, named after its head branch or `pr/<number>`; until then it
 * stays where it reads. `checkout` itself when nothing changes.
 */
export async function followReviewedBranch(
  root: string,
  checkout: ReviewCheckout,
  {
    head,
    dir,
    chatId,
    fixing,
  }: { head: string; dir: string; chatId: string; fixing: boolean },
): Promise<ReviewCheckout> {
  let branch = checkout.branch;
  if (!branch && checkout.pr && fixing) {
    const pick = await pullBranch(root, checkout.pr, head, true);
    if (pick?.made) await git(root, ["branch", pick.branch, head]);
    branch = pick?.branch;
  }
  if (!branch) return checkout;
  const own = join(reviewCheckoutsIn(dir), chatId);
  const about = { branch, ...(checkout.pr ? { pr: checkout.pr } : {}) };
  const at = await folderOf(root, branch);
  if (at && (await sameFolder(at, checkout.path)))
    return branch === checkout.branch ? checkout : { ...checkout, branch };
  if (at) {
    const ours =
      ownerOf(basename(at)) === chatId &&
      (await sameFolder(dirname(at), dirname(own)));
    return { path: at, made: ours, ...about };
  }
  // Checked out nowhere: the review's own worktree takes it, as it is or made again.
  if (!(await exists(own))) {
    await addWorktree(root, own, head, branch);
    return { path: own, made: true, ...about };
  }
  const switched = await git(own, ["switch", "--quiet", branch], 60000).then(
    () => true,
    (e: unknown) => {
      console.warn(`Could not switch the review worktree to ${branch}:`, e);
      return false;
    },
  );
  if (switched) return { path: own, made: true, ...about };
  // Edits there are in the way. A question reads on where the review is; a
  // fix gets a worktree on the branch beside it, the edits left alone.
  if (!fixing) return checkout;
  let beside = `${own}-2`;
  for (let n = 3; await exists(beside); n++) beside = `${own}-${n}`;
  await addWorktree(root, beside, head, branch);
  return { path: beside, made: true, ...about };
}

/**
 * What removing a worktree made for a review would lose: edits not
 * committed, or commits that no branch, tag, remote branch or fetched pull
 * request holds. Undefined when nothing.
 */
export async function reviewCheckoutHoldsWork(path: string) {
  if (!(await stat(join(path, ".git")).catch(() => null))?.isFile())
    return "it isn't a linked worktree";
  if (await dirty(path)) return "it has uncommitted changes";
  const stray = await git(path, [
    "rev-list",
    "-n1",
    "HEAD",
    "--not",
    "--branches",
    "--tags",
    "--remotes",
    "--glob=refs/relay/pulls/*",
  ]);
  if (stray.trim()) return "it has commits on no branch";
}

/** Removes a worktree made for a review, from its own repository. */
export async function removeReviewCheckout(path: string) {
  const common = (
    await git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  ).trim();
  await git(dirname(common), ["worktree", "remove", "--force", path], 60000);
}

/** A thread as the sweep reads it: the folders it works in. */
export interface ThreadFolders {
  id: string;
  archivedAt?: number;
  worktree?: { path?: string };
  reviewFolder?: { path: string };
}

/**
 * Removes each worktree made for a review whose thread is `done` with it,
 * as long as it holds nothing Git couldn't give back and no other thread
 * not archived works in it: a thread that carried the branch on there, or
 * another review of the branch.
 */
export async function sweepReviewCheckouts(
  dir: string,
  done: (chatId: string) => boolean,
  threads: readonly ThreadFolders[] = [],
) {
  const folder = reviewCheckoutsIn(dir);
  const names = await readdir(folder).catch(() => [] as string[]);
  for (const name of names) {
    const owner = ownerOf(name);
    if (!done(owner)) continue;
    const path = join(folder, name);
    let used = false;
    for (const t of threads) {
      if (t.id === owner || t.archivedAt) continue;
      for (const p of [t.worktree?.path, t.reviewFolder?.path])
        if (p && (await sameFolder(p, path))) used = true;
    }
    if (used) continue;
    const why = await reviewCheckoutHoldsWork(path).catch((e: unknown) =>
      e instanceof Error ? e.message : String(e),
    );
    if (why) continue;
    await removeReviewCheckout(path).catch((e: unknown) =>
      console.warn(`Could not remove the review worktree ${path}:`, e),
    );
  }
}

/**
 * Removes a worktree Relay made for a review that never started. Only what
 * Git no longer counts as a worktree, a half-made folder, is deleted
 * outright: one it does may hold work by now.
 */
export async function discardReviewCheckout(checkout: ReviewCheckout) {
  if (!checkout.made) return;
  await removeReviewCheckout(checkout.path).catch(async (e: unknown) => {
    if (await exists(join(checkout.path, ".git")))
      return console.warn(
        `Could not remove the review worktree ${checkout.path}:`,
        e,
      );
    await rm(checkout.path, { recursive: true, force: true });
  });
}
