import { lstat, mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { git as gitIn } from "./git";
import {
  apply,
  commitTree,
  parseNumstat,
  plan,
  revisionDiff,
  snapshotTree,
} from "./turn-changes";
import type { ChatWorktree, TurnFileChange } from "../../shared/projects";

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
/** The checkout's edits as they moved into a thread's worktree. */
const movedRef = (chatId: string) => `refs/relay/worktrees/${chatId}/moved`;

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
  const head = await checkoutHead(root);
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

/**
 * Moves every uncommitted edit in the checkout into a new worktree, as
 * uncommitted edits there, and puts the checkout's files back to its commit.
 * What moved is kept under a ref first. Anything edited while moving stays in
 * the checkout where it merges; when it doesn't, nothing in the checkout changes.
 */
export async function moveIntoWorktree(
  root: string,
  dir: string,
  name: string,
  chatId: string,
): Promise<MadeWorktree> {
  const { head, tree, files } = await uncommitted(root);
  const made = await createWorktree(root, dir, name);
  const paths = files.map((f) => f.path);
  let steps: Awaited<ReturnType<typeof plan>>["steps"] = [];
  try {
    if (made.head !== head)
      throw new Error(
        "The project folder got a new commit while moving. Try again.",
      );
    if (paths.length) {
      // The fresh worktree's files become the snapshot's, unstaged like they were.
      await git(made.path, ["read-tree", "-u", "--reset", tree], 120000);
      await git(made.path, ["reset", "-q"]);
      await git(root, [
        "update-ref",
        movedRef(chatId),
        await commitTree(
          root,
          tree,
          head,
          "Relay: the project folder's edits as they moved into a worktree",
        ),
      ]);
      const planned = await plan(root, paths, tree, head, false);
      if (planned.conflicts.length)
        throw new Error(
          `${planned.conflicts.slice(0, 3).join(", ")}${planned.conflicts.length > 3 ? ` and ${planned.conflicts.length - 3} more` : ""} changed while moving. Try again.`,
        );
      steps = planned.steps;
    }
  } catch (e) {
    await git(root, ["worktree", "remove", "--force", made.path])
      .catch(() => rm(made.path, { recursive: true, force: true }))
      .then(() => git(root, ["branch", "-D", made.branch]))
      .catch(() => {});
    throw e;
  }
  // From here the worktree holds the edits, so it stays even if this fails.
  await apply(root, head, steps);
  // A staged edit would otherwise linger in the checkout's index.
  for (let i = 0; i < paths.length; i += 500)
    await git(root, ["reset", "-q", "--", ...paths.slice(i, i + 500)]);
  return made;
}

/**
 * A worktree for work that arrived from another computer: a new `relay/…`
 * branch at `commit`, counting its changes from `start` on `from`, as they
 * did there, when this repository has both.
 */
export async function adoptWorktree(
  root: string,
  dir: string,
  name: string,
  commit: string,
  { from, start }: { from?: string; start?: string } = {},
): Promise<MadeWorktree> {
  const has = (ref: string) =>
    git(root, ["rev-parse", "-q", "--verify", ref]).then(
      (s) => s.trim(),
      () => undefined,
    );
  const local = from && (await has(`refs/heads/${from}^{commit}`));
  const current = (await git(root, ["branch", "--show-current"])).trim();
  const source = local ? from : current || undefined;
  const base =
    (start && (await has(`${start}^{commit}`))) ||
    (source &&
      (await git(root, ["merge-base", `refs/heads/${source}`, commit]).then(
        (s) => s.trim(),
        () => undefined,
      ))) ||
    commit;
  const folder = join(dir, slug(basename(root)));
  await mkdir(folder, { recursive: true });
  const leaf = await freeName(root, folder, slug(name));
  const path = join(folder, leaf);
  const branch = `relay/${leaf}`;
  await git(root, ["worktree", "prune"]).catch(() => {});
  await git(
    root,
    ["worktree", "add", "-q", "-b", branch, path, commit],
    120000,
  );
  await linkModules(root, path);
  return {
    path,
    branch,
    head: base,
    start: base,
    base,
    ...(source ? { from: source } : {}),
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

/**
 * Brings back a worktree removed with its branch kept, at its old folder:
 * the branch as it was when it holds commits the checkout lacks, so the
 * thread carries on where it stopped; otherwise the branch moves up to the
 * checkout's commit, like a fresh worktree. Undefined when it can't: the
 * branch is gone, its folder is taken, or it's checked out elsewhere.
 */
export async function reattachWorktree(
  root: string,
  previous: ChatWorktree,
): Promise<ChatWorktree | undefined> {
  const { path, branch } = previous;
  if (!path || branch !== `relay/${basename(path)}` || (await exists(path)))
    return undefined;
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
  await git(root, ["worktree", "prune"]).catch(() => {});
  try {
    if (ahead) await git(root, ["worktree", "add", "-q", path, branch], 120000);
    // Everything on it is in the checkout's commit, so moving it loses nothing.
    else
      await git(
        root,
        ["worktree", "add", "-q", "-B", branch, path, head],
        120000,
      );
  } catch {
    return undefined;
  }
  await linkModules(root, path);
  const { removedAt: _removed, cleanedUp: _cleaned, ...rest } = previous;
  if (ahead) return rest;
  const from = (await git(root, ["branch", "--show-current"])).trim();
  return {
    path,
    branch,
    head,
    start: head,
    base: head,
    ...(from ? { from } : {}),
  };
}

const checkoutHead = (root: string) =>
  git(root, ["rev-parse", "-q", "--verify", "HEAD^{commit}"]).then(
    (s) => s.trim(),
    () => {
      throw new Error("Make a first commit before working in a worktree.");
    },
  );

/**
 * Removes the worktree, keeping a snapshot of what it held, and its branch
 * too unless `keepBranch`.
 */
export async function removeWorktree(
  root: string,
  chatId: string,
  worktree: ChatWorktree,
  { keepBranch = false } = {},
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
  if (worktree.branch && !keepBranch)
    await git(root, ["branch", "-D", worktree.branch]).catch(() => {});
}
