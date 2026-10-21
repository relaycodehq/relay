import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git as gitIn } from "../git";
import { parseNumstat, revisionDiff, snapshotTree } from "../turn-changes";
import type { ChatWorktree, TurnFileChange } from "../../../shared/projects";
import { git, exists } from "./common";

// What a worktree holds: its changes since it forked, and uncommitted work.

/** The checkout's uncommitted edits, untracked files included, against its commit. */
export async function uncommitted(root: string) {
  const head = (
    await git(root, ["rev-parse", "-q", "--verify", "HEAD^{commit}"]).catch(
      () => {
        throw new Error("Make a first commit before working in a worktree.");
      },
    )
  ).trim();
  const snapshot = await snapshotTree(root);
  const raw = await git(root, [
    "diff",
    "--raw",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    head,
    snapshot,
  ]);
  // A nested repository or submodule is a commit id, not file contents, so
  // it stays in the checkout instead of moving.
  const nested: { path: string; mode: string; sha: string }[] = [];
  const entries = raw.split("\0");
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const [before, after, sha] = entries[i].slice(1).split(" ");
    if (before === "160000" || after === "160000")
      nested.push({ path: entries[i + 1], mode: before, sha });
  }
  const tree = nested.length
    ? await withoutNested(root, snapshot, nested)
    : snapshot;
  const numstat = await git(root, [
    "diff",
    "--numstat",
    "-z",
    "--no-textconv",
    "--no-renames",
    "--no-color",
    "--no-ext-diff",
    head,
    tree,
  ]);
  return { head, tree, files: parseNumstat(numstat) };
}

/** `tree` with each nested path put back as `head` had it, or gone if it had none. */
async function withoutNested(
  root: string,
  tree: string,
  nested: { path: string; mode: string; sha: string }[],
) {
  const scratch = await mkdtemp(join(tmpdir(), "relay-nested-"));
  const env = { GIT_INDEX_FILE: join(scratch, "index") };
  try {
    await gitIn(root, ["read-tree", tree], { env });
    for (const { path, mode, sha } of nested)
      await gitIn(
        root,
        mode === "000000"
          ? ["update-index", "--force-remove", "--", path]
          : ["update-index", "--add", "--cacheinfo", `${mode},${sha},${path}`],
        { env },
      );
    return (await gitIn(root, ["write-tree"], { env })).trim();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export const worktreeExists = (worktree: ChatWorktree) =>
  !!worktree.path && !worktree.removedAt && exists(worktree.path);

/**
 * What the worktree's changes count from: where its branch forks from the
 * branch it was made from, so merging that way makes them drop out. Worktrees
 * from before that started from a snapshot of the checkout's uncommitted
 * edits; they keep counting from it.
 */
async function forkPoint(worktree: ChatWorktree) {
  if (!worktree.from) return worktree.base!;
  return git(worktree.path!, [
    "merge-base",
    `refs/heads/${worktree.from}`,
    "HEAD",
  ]).then(
    (s) => s.trim(),
    () => worktree.start!,
  );
}

/** The worktree's tree now, and what it has that its branch's source doesn't, committed or not. */
export async function worktreeChanges(
  worktree: ChatWorktree,
): Promise<{ tree: string; files: TurnFileChange[] }> {
  const [tree, from] = await Promise.all([
    snapshotTree(worktree.path!),
    forkPoint(worktree),
  ]);
  const diff = await git(worktree.path!, [
    "diff",
    "--numstat",
    "-z",
    "--no-renames",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    from,
    tree,
  ]);
  return { tree, files: parseNumstat(diff) };
}

export const worktreeDiff = async (worktree: ChatWorktree, path: string) =>
  revisionDiff(
    worktree.path!,
    await forkPoint(worktree),
    await snapshotTree(worktree.path!),
    path,
  );

/**
 * What removing the worktree would lose that Git couldn't give back, if
 * anything: edits not committed, files Git doesn't track yet (ignored ones
 * aside), or commits no branch, tag or remote branch holds, like ones made on
 * a detached HEAD. Refuses a folder that isn't a linked worktree.
 */
export async function worktreeHoldsWork(path: string) {
  // A main checkout keeps a `.git` folder; a linked worktree only a file pointing to it.
  if (!(await lstat(join(path, ".git")).catch(() => null))?.isFile())
    return "it isn't a linked worktree";
  if (await git(path, ["status", "--porcelain", "--untracked-files=normal"]))
    return "it has uncommitted changes";
  const stray = await git(path, [
    "rev-list",
    "-n1",
    "HEAD",
    "--not",
    "--branches",
    "--tags",
    "--remotes",
  ]);
  if (stray.trim()) return "it has commits on no branch";
}
