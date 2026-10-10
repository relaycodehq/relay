// Where a review of a branch or pull request that isn't checked out reads its
// files: a clean worktree that already has the branch, or a detached one
// Relay makes for the review, so reviewers open the reviewed code itself
// rather than the thread's checkout.
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { currentBranchOrNull, git } from "../git/git";
import type { ReviewCheckout, ReviewScope } from "../../shared/deep-review";

/** The folder under Relay's worktrees that holds the ones made for reviews, one per review thread. */
export const reviewCheckoutsIn = (worktrees: string) =>
  join(worktrees, "deep-reviews");

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

/** Each worktree of the repository and the branch it has checked out, if any. */
async function worktreesOf(root: string) {
  const list = await git(root, ["worktree", "list", "--porcelain"]);
  return list
    .split("\n\n")
    .map((block) => {
      const line = (key: string) =>
        block
          .split("\n")
          .find((l) => l.startsWith(key + " "))
          ?.slice(key.length + 1);
      return { path: line("worktree"), branch: line("branch") };
    })
    .filter((w): w is { path: string; branch: string | undefined } =>
      Boolean(w.path),
    );
}

const dirty = async (path: string) =>
  !!(await git(path, ["status", "--porcelain", "--untracked-files=normal"]));

/** Where `branch` is checked out other than `here`, if anywhere. */
async function checkedOutElsewhere(root: string, branch: string, here: string) {
  return (await worktreesOf(root)).find(
    (w) =>
      w.branch === `refs/heads/${branch}` && resolve(w.path) !== resolve(here),
  )?.path;
}

/** The reviewed code isn't what the thread's checkout has: a pull request, or a branch other than its own. */
export function needsCheckout(scope: ReviewScope) {
  const t = scope.target;
  if (t.kind === "pr") return true;
  return t.kind === "branch" && (t.head ?? scope.branch) !== scope.branch;
}

async function addDetached(root: string, path: string, head: string) {
  await mkdir(dirname(path), { recursive: true });
  // A folder deleted by hand leaves Git's record of it behind.
  await git(root, ["worktree", "prune"]).catch(() => {});
  await git(root, ["worktree", "add", "-q", "--detach", path, head], 120000);
}

/**
 * Where the review reads the code `scope` covers. A branch already checked
 * out in a clean worktree is reviewed there; otherwise Relay makes a
 * detached worktree at its head in `dir`, named after the review thread
 * `chatId`. Undefined when the thread's checkout already has it. Nothing is
 * copied in and no setup runs: reviewers only read.
 */
export async function openReviewCheckout(
  root: string,
  scope: ReviewScope,
  dir: string,
  chatId: string,
): Promise<ReviewCheckout | undefined> {
  if (!needsCheckout(scope) || !scope.head) return;
  const t = scope.target;
  const branch =
    t.kind === "branch" && t.head && (await isLocalBranch(root, t.head))
      ? t.head
      : undefined;
  if (branch) {
    const at = await checkedOutElsewhere(root, branch, root);
    if (at && !(await dirty(at).catch(() => true)))
      return { path: at, made: false, branch };
  }
  const path = join(reviewCheckoutsIn(dir), chatId);
  await addDetached(root, path, scope.head);
  return { path, made: true, ...(branch ? { branch } : {}) };
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
  await addDetached(root, checkout.path, head);
  return checkout.path;
}

/**
 * Before a fix in a worktree Relay made, checks the reviewed branch out
 * there so the fix lands on it rather than on a detached HEAD. Refuses when
 * Git can't, because the branch is checked out in another folder.
 */
export async function checkOutForFixes(checkout: ReviewCheckout) {
  const { path, branch } = checkout;
  if (!checkout.made || !branch) return;
  if ((await currentBranchOrNull(path)) === branch) return;
  const elsewhere = await checkedOutElsewhere(path, branch, path);
  if (elsewhere)
    throw new Error(
      `${branch} is checked out at ${elsewhere}, so Relay can't also check it out in this review's folder to fix it there. Switch that folder to another branch, or fix it in that folder, then ask again.`,
    );
  await git(path, ["switch", "--quiet", branch], 60000);
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

/**
 * Removes each worktree made for a review whose thread is `done` with it,
 * as long as it holds nothing Git couldn't give back.
 */
export async function sweepReviewCheckouts(
  dir: string,
  done: (chatId: string) => boolean,
) {
  const folder = reviewCheckoutsIn(dir);
  const names = await readdir(folder).catch(() => [] as string[]);
  for (const name of names) {
    if (!done(name)) continue;
    const path = join(folder, name);
    const why = await reviewCheckoutHoldsWork(path).catch((e: unknown) =>
      e instanceof Error ? e.message : String(e),
    );
    if (why) continue;
    await removeReviewCheckout(path).catch((e: unknown) =>
      console.warn(`Could not remove the review worktree ${path}:`, e),
    );
  }
}

/** Removes a worktree Relay made for a review that never started. */
export async function discardReviewCheckout(checkout: ReviewCheckout) {
  if (!checkout.made) return;
  await removeReviewCheckout(checkout.path).catch(async () => {
    await rm(checkout.path, { recursive: true, force: true });
  });
}
