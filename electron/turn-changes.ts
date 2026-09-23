import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdtemp,
  rm,
  rmdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { decodeText } from "./working-files";
import { digest } from "./hash";
import { gitEnv } from "./git";
import type { FilePair } from "../shared/types";
import type { TurnFileChange } from "../shared/projects";

// Adapted from T3 Code's Git checkpoints: each agent turn snapshots the whole
// worktree before and after, so its card lists exactly what that turn changed.
const exec = promisify(execFile);
const identity = {
  GIT_AUTHOR_NAME: "Relay",
  GIT_AUTHOR_EMAIL: "relay@localhost",
  GIT_COMMITTER_NAME: "Relay",
  GIT_COMMITTER_EMAIL: "relay@localhost",
};
// Git renames objects and refs into place without fsync by default, so an
// unclean restart could leave empty files under refs/relay that break fetches.
const durable = [
  "-c",
  "core.fsync=objects,reference",
  "-c",
  "core.fsyncMethod=fsync",
];
const noMonitor = ["-c", "core.fsmonitor=false"];
const maxFiles = 1000;
const maxText = 2 * 1024 * 1024;

async function run(root: string, args: string[], env?: NodeJS.ProcessEnv) {
  return (
    await exec("git", ["-C", root, ...args], {
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
      env: gitEnv(env),
    })
  ).stdout;
}

/** One ref per turn: its commit is the after snapshot, its parent the before. */
export const turnRef = (messageId: string) => `refs/relay/turns/${messageId}`;

/** Commits the worktree, untracked files included, without touching the real index. */
async function snapshot(root: string, parent?: string) {
  const index = (
    await run(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ])
  ).trim();
  const temp = `${index}.relay-${randomUUID()}`;
  const env = { GIT_INDEX_FILE: temp, ...identity };
  try {
    // A copy of the real index keeps Git's stat cache, so `add` only rehashes
    // files that changed. Dating the copy just below the original keeps Git's
    // racy-clean check rehashing files touched in the same second.
    const seeded = await stat(index).then(
      async ({ mtimeMs }) => {
        const seconds = Math.floor((mtimeMs - 1) / 1000);
        if (seconds <= 0) return false;
        await copyFile(index, temp);
        await utimes(temp, seconds, seconds);
        return true;
      },
      () => false,
    );
    if (!seeded) {
      await rm(temp, { force: true });
      const head = await run(root, [
        "rev-parse",
        "-q",
        "--verify",
        "HEAD^{commit}",
      ]).then(
        () => true,
        () => false,
      );
      if (head) await run(root, ["read-tree", "HEAD"], env);
    }
    await run(root, [...noMonitor, ...durable, "add", "-A", "--", "."], env);
    const tree = (
      await run(root, [...noMonitor, ...durable, "write-tree"], env)
    ).trim();
    return (
      await run(
        root,
        [
          ...durable,
          "commit-tree",
          tree,
          ...(parent ? ["-p", parent] : []),
          "-m",
          "Relay turn snapshot",
        ],
        env,
      )
    ).trim();
  } finally {
    await rm(temp, { force: true });
    await rm(`${temp}.lock`, { force: true });
  }
}

/** Reads `git diff --numstat -z`; binary files report no line counts. */
export function parseNumstat(output: string): TurnFileChange[] {
  const files: TurnFileChange[] = [];
  for (const record of output.split("\0")) {
    const counts = /^(\d+|-)\t(\d+|-)\t/.exec(record);
    const path = counts && record.slice(counts[0].length);
    if (!counts || !path) continue;
    files.push({
      path,
      additions: counts[1] === "-" ? 0 : Number(counts[1]),
      deletions: counts[2] === "-" ? 0 : Number(counts[2]),
      ...(counts[1] === "-" ? { binary: true } : {}),
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Snapshots the worktree as a turn starts. Null when it can't: the turn runs without a card. */
export async function startTurn(root: string, messageId: string) {
  try {
    const before = await snapshot(root);
    await run(root, [...durable, "update-ref", turnRef(messageId), before]);
    return before;
  } catch {
    return null;
  }
}

/**
 * Snapshots the worktree again and lists what the turn changed. A turn without
 * changes keeps no ref. The ref moves to `answerId` when a steer split the
 * turn, so the diff opens from the message that shows the changes.
 */
export async function finishTurn(
  root: string,
  messageId: string,
  before: string,
  answerId = messageId,
): Promise<TurnFileChange[]> {
  const ref = turnRef(messageId);
  try {
    const after = await snapshot(root, before);
    const files = parseNumstat(
      await run(root, [
        "diff",
        "--numstat",
        "-z",
        "--no-renames",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        before,
        after,
      ]),
    ).slice(0, maxFiles);
    if (!files.length) await run(root, ["update-ref", "-d", ref]);
    else if (answerId === messageId)
      await run(root, [...durable, "update-ref", ref, after, before]);
    else {
      await run(root, [...durable, "update-ref", turnRef(answerId), after]);
      await run(root, ["update-ref", "-d", ref]);
    }
    return files;
  } catch {
    await run(root, ["update-ref", "-d", ref]).catch(() => {});
    return [];
  }
}

/** One file as the turn left it, against how the turn found it. */
export async function turnDiff(
  root: string,
  messageId: string,
  path: string,
): Promise<FilePair> {
  const ref = turnRef(messageId);
  const exists = await run(root, [
    "rev-parse",
    "-q",
    "--verify",
    `${ref}^{commit}`,
  ]).then(
    () => true,
    () => false,
  );
  if (!exists) throw new Error("This turn's snapshot is no longer available.");
  let binary = false;
  const read = async (rev: string) => {
    const spec = `${rev}:${path}`;
    const size = await run(root, ["cat-file", "-s", spec]).then(
      (s) => Number(s.trim()),
      () => null,
    );
    if (size === null) return null;
    if (size > maxText) {
      binary = true;
      return null;
    }
    const bytes = (
      await exec("git", ["-C", root, "cat-file", "blob", spec], {
        timeout: 15000,
        maxBuffer: maxText + 4096,
        encoding: "buffer",
        env: gitEnv(),
      })
    ).stdout;
    if (bytes.includes(0)) {
      binary = true;
      return null;
    }
    const contents = decodeText(bytes);
    return { name: path, contents, cacheKey: digest(contents) };
  };
  const [old, next] = await Promise.all([read(`${ref}^`), read(ref)]);
  return binary
    ? { old: null, next: null, binary: true }
    : { old, next, binary: false };
}

/** Where a rollback keeps its before/after snapshots, so it can be redone. */
export const revertRef = (messageId: string, commit: string) =>
  `refs/relay/reverts/${messageId}/${commit}`;

export interface RewindResult {
  /** Files now as the rollback (or redo) intended. */
  moved: string[];
  /** Files edited since that couldn't merge; nothing was written when any exist, unless forced. */
  conflicts: string[];
  /** The rollback's snapshot; redo restores what it replaced. */
  undo?: string;
}

type Step =
  | { path: string; kind: "keep" | "restore" | "delete" }
  | { path: string; kind: "merge"; contents: Buffer };

const blobId = (root: string, rev: string, path: string) =>
  run(root, ["rev-parse", "-q", "--verify", `${rev}:${path}`]).then(
    (s) => s.trim(),
    () => null,
  );

/** The worktree file's blob id as `git add` would store it; "other" for anything but a file. */
async function worktreeId(root: string, path: string) {
  const info = await lstat(join(root, path)).catch(() => null);
  if (!info) return null;
  if (!info.isFile()) return "other";
  return (await run(root, [...noMonitor, "hash-object", "--", path])).trim();
}

/** A blob as it would be checked out, line endings and filters applied. */
async function checkedOut(root: string, rev: string, path: string) {
  return (
    await exec("git", ["-C", root, "cat-file", "--filters", `${rev}:${path}`], {
      timeout: 15000,
      maxBuffer: maxText + 4096,
      encoding: "buffer",
      // Filters such as LFS may reach the network; they must not prompt.
      env: gitEnv(),
    })
  ).stdout;
}

/** Undoes `from` → `to` on top of whatever the file holds now; null when it conflicts. */
async function mergeBack(root: string, path: string, from: string, to: string) {
  const dir = await mkdtemp(join(tmpdir(), "relay-rewind-"));
  try {
    const base = join(dir, "base");
    const other = join(dir, "other");
    await writeFile(base, await checkedOut(root, from, path));
    await writeFile(other, await checkedOut(root, to, path));
    // Exits non-zero on conflicts and refuses binary files: both stay as they are.
    return (
      await exec(
        "git",
        ["-C", root, "merge-file", "-p", "-q", join(root, path), base, other],
        {
          timeout: 15000,
          maxBuffer: maxText * 2,
          encoding: "buffer",
          env: gitEnv(),
        },
      )
    ).stdout;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Plans moving files from how `from` has them to how `to` has them, keeping
 * edits made since: an untouched file is replaced, an edited one merged.
 */
async function plan(
  root: string,
  paths: string[],
  from: string,
  to: string,
  force: boolean,
) {
  const steps: Step[] = [];
  const conflicts: string[] = [];
  await Promise.all(
    paths.map(async (path) => {
      const [had, want, now] = await Promise.all([
        blobId(root, from, path),
        blobId(root, to, path),
        worktreeId(root, path),
      ]);
      if (now === want) return steps.push({ path, kind: "keep" });
      const replace: Step = { path, kind: want ? "restore" : "delete" };
      if (force || now === had) return steps.push(replace);
      const contents =
        had && want && now && now !== "other"
          ? await mergeBack(root, path, from, to)
          : null;
      if (contents) steps.push({ path, kind: "merge", contents });
      else conflicts.push(path);
    }),
  );
  return { steps, conflicts: conflicts.sort() };
}

async function apply(root: string, to: string, steps: Step[]) {
  const restore = steps.filter((s) => s.kind === "restore").map((s) => s.path);
  if (restore.length) {
    // A scratch index checks files out of `to` with their modes and filters,
    // leaving the real index alone.
    const index = join(await mkdtemp(join(tmpdir(), "relay-rewind-")), "index");
    const env = { GIT_INDEX_FILE: index };
    try {
      await run(root, ["read-tree", to], env);
      await run(root, ["checkout-index", "-f", "--", ...restore], env);
    } finally {
      await rm(dirname(index), { recursive: true, force: true });
    }
  }
  for (const step of steps) {
    if (step.kind === "merge")
      await writeFile(join(root, step.path), step.contents);
    if (step.kind !== "delete") continue;
    await rm(join(root, step.path), { force: true });
    // Like Git, drop folders the deletion left empty.
    for (let dir = dirname(step.path); dir !== "."; dir = dirname(dir))
      if (
        !(await rmdir(join(root, dir)).then(
          () => true,
          () => false,
        ))
      )
        break;
  }
}

/**
 * Puts files back the way a turn found them, keeping later edits where they
 * merge. Checks every file first: with conflicts and no `force`, writes nothing.
 */
export async function revertTurn(
  root: string,
  messageId: string,
  paths: string[],
  force = false,
): Promise<RewindResult> {
  const ref = turnRef(messageId);
  await run(root, ["rev-parse", "-q", "--verify", `${ref}^{commit}`]).catch(
    () => {
      throw new Error("This turn's snapshot is no longer available.");
    },
  );
  const { steps, conflicts } = await plan(root, paths, ref, `${ref}^`, force);
  if (conflicts.length) return { moved: [], conflicts };
  const before = await snapshot(root);
  await apply(root, `${ref}^`, steps);
  const after = await snapshot(root, before);
  await run(root, [
    ...durable,
    "update-ref",
    revertRef(messageId, after),
    after,
  ]);
  return { moved: paths, conflicts: [], undo: after };
}

/** Undoes a rollback: brings back what it replaced, keeping edits made since. */
export async function redoRevert(
  root: string,
  messageId: string,
  undo: string,
  paths: string[],
  force = false,
  /** Only report conflicts, writing nothing. */
  check = false,
): Promise<RewindResult> {
  const ref = revertRef(messageId, undo);
  await run(root, ["rev-parse", "-q", "--verify", `${ref}^{commit}`]).catch(
    () => {
      throw new Error("This rollback's snapshot is no longer available.");
    },
  );
  const { steps, conflicts } = await plan(root, paths, ref, `${ref}^`, force);
  if (conflicts.length || check) return { moved: [], conflicts };
  await apply(root, `${ref}^`, steps);
  return { moved: paths, conflicts: [] };
}

/** Forgets a rollback once no file can be redone from it. */
export const dropRevert = (root: string, messageId: string, undo: string) =>
  run(root, ["update-ref", "-d", revertRef(messageId, undo)]).then(
    () => {},
    () => {},
  );
