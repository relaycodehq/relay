import { lstat, mkdir, rm, stat, symlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { git as gitIn } from "./git";
import {
  commitTree,
  parseNumstat,
  revisionDiff,
  snapshotTree,
} from "./turn-changes";
import type { ChatWorktree, TurnFileChange } from "../shared/projects";

// A thread's worktree lives outside the project, under Relay's data folder, on
// a `relay/…` branch of its own made from the checkout's commit. It's an
// ordinary branch: commit, push and merge it like any other. Its changes are
// what it has that the branch it came from doesn't.

/** Worktree operations walk a whole checkout, so they get twice Git's usual time. */
const git = (root: string, args: string[], timeout = 30000) =>
  gitIn(root, args, timeout);
export type MadeWorktree = Required<
  Pick<ChatWorktree, "path" | "branch" | "head" | "start" | "base">
> &
  Pick<ChatWorktree, "from">;

/** What a worktree held when it was removed, in case it's wanted back. */
const keptRef = (chatId: string) => `refs/relay/worktrees/${chatId}/kept`;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "thread";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function freeName(root: string, dir: string, name: string) {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`;
    const taken = await git(root, [
      "rev-parse",
      "-q",
      "--verify",
      `refs/heads/relay/${candidate}`,
    ]).then(
      () => true,
      () => false,
    );
    if (!taken && !(await exists(join(dir, candidate)))) return candidate;
  }
}

/**
 * Makes a worktree on a new `relay/…` branch from the checkout's commit.
 * Uncommitted edits stay in the checkout. `node_modules` is linked from the
 * checkout when Git ignores it there, so the project runs without installing.
 * A thread making its worktree again takes its old folder back when it's free,
 * so the agent's session finds the same working directory.
 */
export async function createWorktree(
  root: string,
  dir: string,
  name: string,
  previous?: ChatWorktree,
): Promise<MadeWorktree> {
  const head = await git(root, [
    "rev-parse",
    "-q",
    "--verify",
    "HEAD^{commit}",
  ]).then(
    (s) => s.trim(),
    () => {
      throw new Error("Make a first commit before working in a worktree.");
    },
  );
  const from = (await git(root, ["branch", "--show-current"])).trim();
  const folder = join(dir, slug(basename(root)));
  await mkdir(folder, { recursive: true });
  const leaf =
    previous?.path && previous.branch === `relay/${basename(previous.path)}`
      ? await freeName(root, folder, basename(previous.path))
      : await freeName(root, folder, slug(name));
  const path = join(folder, leaf);
  const branch = `relay/${leaf}`;
  // A folder deleted by hand leaves Git's record of it behind.
  await git(root, ["worktree", "prune"]).catch(() => {});
  await git(root, ["worktree", "add", "-q", "-b", branch, path, head], 120000);
  await linkModules(root, path);
  return {
    path,
    branch,
    head,
    start: head,
    base: head,
    ...(from ? { from } : {}),
  };
}

async function linkModules(root: string, path: string) {
  const source = join(root, "node_modules");
  const info = await lstat(source).catch(() => null);
  if (
    !info?.isDirectory() ||
    (await lstat(join(path, "node_modules")).catch(() => null))
  )
    return;
  await symlink(source, join(path, "node_modules"), "dir").catch(() => {});
  // A link Git doesn't ignore would show up as the thread's own change.
  // check-ignore rejects literal pathspec magic outright.
  const ignored = await gitIn(path, ["check-ignore", "-q", "node_modules"], {
    env: { GIT_LITERAL_PATHSPECS: undefined },
  }).then(
    () => true,
    () => false,
  );
  if (!ignored) await rm(join(path, "node_modules"), { force: true });
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
): Promise<{ tree: string; files: TurnFileChange[]; commits: number }> {
  const [tree, from] = await Promise.all([
    snapshotTree(worktree.path!),
    forkPoint(worktree),
  ]);
  const [diff, commits] = await Promise.all([
    git(worktree.path!, [
      "diff",
      "--numstat",
      "-z",
      "--no-renames",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      from,
      tree,
    ]),
    git(worktree.path!, ["rev-list", "--count", `${worktree.start}..HEAD`]),
  ]);
  return { tree, files: parseNumstat(diff), commits: Number(commits) };
}

export const worktreeDiff = async (worktree: ChatWorktree, path: string) =>
  revisionDiff(
    worktree.path!,
    await forkPoint(worktree),
    await snapshotTree(worktree.path!),
    path,
  );

/** Removes the worktree and its branch, keeping a snapshot of what it held. */
export async function removeWorktree(
  root: string,
  chatId: string,
  worktree: ChatWorktree,
) {
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
  if (worktree.branch)
    await git(root, ["branch", "-D", worktree.branch]).catch(() => {});
}
