import { realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { git as gitIn, worktreeList } from "../git";
import type { ChatWorktree } from "../../../shared/projects";

// A thread's worktree lives outside the project, under Relay's data folder, on
// a branch of its own made from the checkout's commit: `relay/…` after the
// thread, or the name the user gave it. It's an ordinary branch: commit, push
// and merge it like any other. Its changes are what it has that the branch it
// came from doesn't.

/** Worktree operations walk a whole checkout, so they get twice Git's usual time. */
export const git = (root: string, args: string[], timeout = 30000) =>
  gitIn(root, args, timeout);

export type MadeWorktree = Required<
  Pick<ChatWorktree, "path" | "branch" | "head" | "start" | "base" | "setup">
> &
  Pick<
    ChatWorktree,
    | "from"
    | "named"
    | "wanted"
    | "included"
    | "existing"
    | "adopted"
    | "startedOff"
  >;

/** What a worktree held when it was removed, in case it's wanted back. */
export const keptRef = (chatId: string) =>
  `refs/relay/worktrees/${chatId}/kept`;

/** The checkout's edits as they moved into a thread's worktree. */
export const movedRef = (chatId: string) =>
  `refs/relay/worktrees/${chatId}/moved`;

/** What was copied into a thread's worktree when it started: where its own changes begin. */
export const copiedRef = (chatId: string) =>
  `refs/relay/worktrees/${chatId}/copied`;

export const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

export const hasBranch = (root: string, branch: string) =>
  git(root, ["rev-parse", "-q", "--verify", `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  );

/** A branch Relay made for a thread: named after it, or by the user for it. */
export const relayBranch = (worktree: ChatWorktree) =>
  !!worktree.path &&
  !!worktree.branch &&
  (worktree.branch === `relay/${basename(worktree.path)}` ||
    worktree.branch === worktree.named);

export const commitOf = (root: string, ref: string) =>
  git(root, ["rev-parse", "-q", "--verify", `${ref}^{commit}`]).then(
    (s) => s.trim(),
    () => undefined,
  );

/** The folder `branch` is checked out in, if any; Git allows it in one only. */
export const checkedOutAt = async (root: string, branch: string) =>
  (await worktreeList(root)).find((w) => w.branch === branch && !w.prunable)
    ?.path;

/** Why the local branch a thread's worktree is on can't be opened in it again. */
export async function carryOnProblem(root: string, branch: string) {
  if (!(await hasBranch(root, branch))) return `There's no branch ${branch}.`;
  const at = await checkedOutAt(root, branch);
  return at ? `${branch} is checked out in ${at} already.` : undefined;
}

/** Where `path` really is, so two spellings of one folder compare equal. */
export const real = (path: string) => realpath(path).catch(() => resolve(path));

/** Whether two paths are one folder, Git's spelling of it or Relay's. */
export const sameFolder = async (a: string, b: string) =>
  resolve(a) === resolve(b) || (await real(a)) === (await real(b));

export const checkoutHead = (root: string) =>
  git(root, ["rev-parse", "-q", "--verify", "HEAD^{commit}"]).then(
    (s) => s.trim(),
    () => {
      throw new Error("Make a first commit before working in a worktree.");
    },
  );
