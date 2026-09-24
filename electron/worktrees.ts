import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { gitEnv } from "./git";
import {
  apply,
  blobId,
  checkedOut,
  commitTree,
  parseNumstat,
  plan,
  revisionDiff,
  run,
  snapshotTree,
  worktreeId,
  type Step,
} from "./turn-changes";
import type { ChatWorktree, TurnFileChange } from "../shared/projects";

// A thread's worktree lives outside the project, under Relay's data folder.
// Its changes are counted from `base`: the checkout as it was, uncommitted
// edits included, so merging back only brings what the thread did.

const exec = promisify(execFile);
export type MadeWorktree = Required<
  Pick<ChatWorktree, "path" | "branch" | "head" | "start" | "base">
>;

/** Keeps each worktree's `base` from being garbage collected. */
const baseRef = (chatId: string) => `refs/relay/worktrees/${chatId}/base`;
/** The commit a worktree's PR pushes; each update builds on the last. */
const pullRef = (chatId: string) => `refs/relay/worktrees/${chatId}/pull`;
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
    const taken = await run(root, [
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
 * Makes a worktree on a new `relay/…` branch from the checkout as it is now,
 * uncommitted and untracked files included. `node_modules` is linked from the
 * checkout when Git ignores it there, so the project runs without installing.
 * A thread making its worktree again takes its old folder back when it's free,
 * so the agent's session finds the same working directory.
 */
export async function createWorktree(
  root: string,
  dir: string,
  chatId: string,
  name: string,
  previous?: ChatWorktree,
): Promise<MadeWorktree> {
  const head = await run(root, [
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
  const tree = await snapshotTree(root);
  const clean =
    tree === (await run(root, ["rev-parse", `${head}^{tree}`])).trim();
  const start = clean
    ? head
    : await commitTree(
        root,
        tree,
        head,
        "Relay: the checkout's uncommitted edits",
      );
  const folder = join(dir, slug(basename(root)));
  await mkdir(folder, { recursive: true });
  const leaf =
    previous?.path && previous.branch === `relay/${basename(previous.path)}`
      ? await freeName(root, folder, basename(previous.path))
      : await freeName(root, folder, slug(name));
  const path = join(folder, leaf);
  const branch = `relay/${leaf}`;
  // A folder deleted by hand leaves Git's record of it behind.
  await run(root, ["worktree", "prune"]).catch(() => {});
  await exec(
    "git",
    ["-C", root, "worktree", "add", "-q", "-b", branch, path, start],
    {
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      env: gitEnv(),
    },
  );
  await run(root, ["update-ref", baseRef(chatId), start]);
  await linkModules(root, path);
  return { path, branch, head, start, base: start };
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
  const ignored = await run(path, ["check-ignore", "-q", "node_modules"]).then(
    () => true,
    () => false,
  );
  if (!ignored) await rm(join(path, "node_modules"), { force: true });
}

export const worktreeExists = (worktree: ChatWorktree) =>
  !!worktree.path && !worktree.removedAt && exists(worktree.path);

/** The worktree's tree now, and what changed in it since `base`. */
export async function worktreeChanges(
  worktree: ChatWorktree,
): Promise<{ tree: string; files: TurnFileChange[] }> {
  const tree = await snapshotTree(worktree.path!);
  const files = parseNumstat(
    await run(worktree.path!, [
      "diff",
      "--numstat",
      "-z",
      "--no-renames",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      worktree.base!,
      tree,
    ]),
  );
  return { tree, files };
}

export const worktreeDiff = async (worktree: ChatWorktree, path: string) =>
  revisionDiff(
    worktree.path!,
    worktree.base!,
    await snapshotTree(worktree.path!),
    path,
  );

/** Whether merging would write nothing: every change is in the checkout already, however it got there. */
export async function landedIn(
  root: string,
  from: string,
  to: string,
  paths: string[],
) {
  const { steps, conflicts } = await plan(root, paths, from, to, false);
  if (conflicts.length) return false;
  for (const step of steps) {
    if (step.kind === "keep") continue;
    if (step.kind !== "merge") return false;
    const now = await readFile(join(root, step.path)).catch(() => null);
    if (!now?.equals(step.contents)) return false;
  }
  return true;
}

/** Moves `base` up to `tree`, so the worktree's changes count from there. */
export async function advance(
  root: string,
  chatId: string,
  worktree: ChatWorktree,
  tree: string,
  message: string,
) {
  const base = await commitTree(root, tree, worktree.base, message);
  await run(root, ["update-ref", baseRef(chatId), base]);
  return base;
}

/**
 * Brings the worktree's changes into the checkout, uncommitted, merging with
 * edits made there since. With any conflict nothing is written. Returns the
 * new `base` when something was merged.
 */
export async function mergeWorktree(
  root: string,
  chatId: string,
  worktree: ChatWorktree,
) {
  const { tree, files } = await worktreeChanges(worktree);
  if (!files.length) return { conflicts: [] as string[] };
  const paths = files.map((f) => f.path);
  const before = await Promise.all(paths.map((p) => worktreeId(root, p)));
  const { steps, conflicts } = await plan(
    root,
    paths,
    worktree.base!,
    tree,
    false,
  );
  if (conflicts.length) return { conflicts };
  // Another thread may be writing to the checkout; don't overwrite what it just wrote.
  const after = await Promise.all(paths.map((p) => worktreeId(root, p)));
  if (after.some((id, i) => id !== before[i]))
    throw new Error(
      "Files in the checkout changed while merging. Merge again.",
    );
  await apply(root, tree, steps);
  return {
    conflicts: [] as string[],
    base: await advance(
      root,
      chatId,
      worktree,
      tree,
      "Relay: merged into the checkout",
    ),
  };
}

/**
 * Brings what changed in the checkout since `base` into the worktree. Files
 * both sides changed are merged; where they clash, Git's conflict markers are
 * left in the worktree's file for the agent to resolve.
 */
export async function catchUpWorktree(
  root: string,
  chatId: string,
  worktree: ChatWorktree,
) {
  const checkout = await snapshotTree(root);
  const paths = parseNumstat(
    await run(root, [
      "diff",
      "--numstat",
      "-z",
      "--no-renames",
      worktree.base!,
      checkout,
    ]),
  ).map((f) => f.path);
  const path = worktree.path!;
  const steps: Step[] = [];
  const conflicts: string[] = [];
  for (const file of paths) {
    const [had, want, now] = await Promise.all([
      blobId(path, worktree.base!, file),
      blobId(path, checkout, file),
      worktreeId(path, file),
    ]);
    if (now === want) continue;
    if (now === had) {
      steps.push({ path: file, kind: want ? "restore" : "delete" });
      continue;
    }
    const merged =
      had && want && now && now !== "other"
        ? await mergeMarked(path, file, worktree.base!, checkout)
        : null;
    if (merged) {
      steps.push({ path: file, kind: "merge", contents: merged.contents });
      if (merged.conflicted) conflicts.push(file);
    } else conflicts.push(file);
  }
  await apply(path, checkout, steps);
  const head = (await run(root, ["rev-parse", "HEAD"])).trim();
  const base = await commitTree(
    root,
    checkout,
    head,
    "Relay: the checkout the worktree caught up with",
  );
  await run(root, ["update-ref", baseRef(chatId), base]);
  return { conflicts: conflicts.sort(), base, head };
}

/** `from` → `to` merged into the worktree's file, conflict markers and all. */
async function mergeMarked(
  path: string,
  file: string,
  from: string,
  to: string,
) {
  const dir = await mkdtemp(join(tmpdir(), "relay-worktree-"));
  try {
    const base = join(dir, "base");
    const other = join(dir, "other");
    await writeFile(base, await checkedOut(path, from, file));
    await writeFile(other, await checkedOut(path, to, file));
    const args = [
      "-C",
      path,
      "merge-file",
      "-p",
      "-L",
      "worktree",
      "-L",
      "before",
      "-L",
      "checkout",
      join(path, file),
      base,
      other,
    ];
    // Exits with the number of conflicts; a negative code means it couldn't merge.
    return await exec("git", args, {
      encoding: "buffer",
      maxBuffer: 8 * 1024 * 1024,
      env: gitEnv(),
    }).then(
      (r) => ({ contents: r.stdout, conflicted: false }),
      (e: { code?: number; stdout?: Buffer }) =>
        typeof e.code === "number" && e.code > 0 && e.code < 128 && e.stdout
          ? { contents: e.stdout, conflicted: true }
          : null,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Makes the worktree's changes one commit on the commit the checkout had, so a
 * PR carries only this thread's work, not edits that were uncommitted in the
 * checkout. Points the worktree's branch at it; its files stay as they are.
 */
export async function pullCommit(
  root: string,
  chatId: string,
  worktree: ChatWorktree,
  title: string,
) {
  const path = worktree.path!;
  const tree = await snapshotTree(path);
  const now = await commitTree(
    root,
    tree,
    worktree.start,
    "Relay: worktree snapshot",
  );
  const previous = await run(root, [
    "rev-parse",
    "-q",
    "--verify",
    pullRef(chatId),
  ]).then(
    (s) => s.trim(),
    () => null,
  );
  const onto = previous ?? worktree.head!;
  const merged = await run(root, [
    "merge-tree",
    "--write-tree",
    "--merge-base",
    worktree.start!,
    onto,
    now,
  ]).then(
    (out) => out.split("\n")[0].trim(),
    () => {
      throw new Error(
        "This worktree's changes build on edits that were uncommitted in your checkout when it started. Merge it into the checkout instead, or commit those edits first.",
      );
    },
  );
  const commit =
    merged === (await run(root, ["rev-parse", `${onto}^{tree}`])).trim()
      ? onto
      : await commitTree(root, merged, onto, title);
  if (commit === worktree.head)
    throw new Error("This worktree has no changes for a PR yet.");
  await run(root, ["update-ref", pullRef(chatId), commit]);
  await run(path, ["update-ref", `refs/heads/${worktree.branch}`, commit]);
  // The index follows the branch; files outside the commit show as the worktree's own edits.
  await run(path, ["read-tree", commit]);
}

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
      await run(root, ["update-ref", keptRef(chatId), kept]);
    }
    await run(root, ["worktree", "remove", "--force", worktree.path]).catch(
      async () => {
        await rm(worktree.path!, { recursive: true, force: true });
        await run(root, ["worktree", "prune"]).catch(() => {});
      },
    );
  }
  if (worktree.branch)
    await run(root, ["branch", "-D", worktree.branch]).catch(() => {});
}
