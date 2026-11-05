import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readlink,
  readdir,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ownFiles, type TurnClaim } from "./turn-claims";
import { checkOut, durable, noMonitor, run, snapshot } from "./turn-snapshots";
import { revisionDiff } from "./revision-diff";
import { mergeBack } from "./merge-back";
import { eachLimited } from "../util/each-limited";
import type { FilePair } from "../../shared/types";
import type { TurnFileChange } from "../../shared/projects";
import { errorMessage } from "../../shared/error-message";

// Each agent turn snapshots the whole worktree before and after; its card
// lists the changes the agent made itself.
const maxFiles = 1000;

/** One ref per turn: its commit is the after snapshot, its parent the before. */
export const turnRef = (messageId: string) => `refs/relay/turns/${messageId}`;

/** A numstat count: digits, or `-` where Git counted no lines; null for anything else. */
function numstatCount(field: string): number | "-" | null {
  if (field === "-") return "-";
  return /^\d+$/.test(field) ? Number(field) : null;
}

/**
 * Reads `git diff --numstat -z`: NUL-separated `added<TAB>deleted<TAB>path`
 * records, where a binary file's counts are `-`. The path is taken whole,
 * tabs and all, since `-z` leaves it unquoted.
 */
export function parseNumstat(output: string): TurnFileChange[] {
  const files: TurnFileChange[] = [];
  for (const record of output.split("\0")) {
    const [added, deleted, ...rest] = record.split("\t");
    const path = rest.join("\t");
    const additions = numstatCount(added);
    const deletions = numstatCount(deleted ?? "");
    if (additions === null || deletions === null || !path) continue;
    const binary = additions === "-";
    files.push({
      path,
      additions: binary ? 0 : additions,
      deletions: deletions === "-" ? 0 : deletions,
      ...(binary ? { binary: true } : {}),
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

/** A turn picked up after a restart keeps the snapshot it started from. */
export async function resumeTurn(root: string, messageId: string) {
  const kept = await run(root, [
    "rev-parse",
    "-q",
    "--verify",
    turnRef(messageId),
  ])
    .then((out) => out.trim())
    .catch(() => "");
  return kept || startTurn(root, messageId);
}

/**
 * Snapshots the worktree again and lists what the turn changed. A turn without
 * changes keeps no ref. The ref moves to `answerId` when a steer split the
 * turn, so the diff opens from the message that shows the changes. With a
 * `claim`, only files the agent changed itself are listed.
 */
export async function finishTurn(
  root: string,
  messageId: string,
  before: string,
  answerId = messageId,
  claim?: TurnClaim,
): Promise<TurnFileChange[]> {
  const ref = turnRef(messageId);
  try {
    const after = await snapshot(root, before);
    let files = parseNumstat(
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
    );
    if (claim) files = ownFiles(files, claim, root);
    files = files.slice(0, maxFiles);
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
  return revisionDiff(root, `${ref}^`, ref, path);
}

/** Where a rollback keeps its before/after snapshots, so it can be redone. */
export const revertRef = (messageId: string, commit: string) =>
  `refs/relay/reverts/${messageId}/${commit}`;

export interface RewindResult {
  /** Files now as the rollback (or redo) intended. */
  moved: string[];
  /** Files edited since that couldn't merge; nothing was written when any exist. */
  conflicts: string[];
  /** The rollback's snapshot; redo restores what it replaced. */
  undo?: string;
}

export type Step =
  | { path: string; kind: "keep" | "restore" | "delete" }
  | { path: string; kind: "mode"; mode: string }
  | { path: string; kind: "merge"; contents: Buffer; mode?: string };

interface Entry {
  id: string;
  mode: string;
}

/** Trees are directories, not entries checkout-index can restore. */
async function blobEntry(
  root: string,
  rev: string,
  path: string,
): Promise<Entry | null> {
  const output = await run(
    root,
    ["ls-tree", "-z", "--full-tree", rev, "--", path],
    {
      GIT_LITERAL_PATHSPECS: "1",
    },
  );
  const [mode, type, id] = output.slice(0, output.indexOf("\t")).split(" ");
  return type === "blob" ? { id, mode } : null;
}

const sameEntry = (a: Entry | null, b: Entry | null, trustMode: boolean) =>
  a === null || b === null
    ? a === b
    : a.id === b.id &&
      (a.mode === b.mode ||
        (!trustMode && a.mode.startsWith("100") && b.mode.startsWith("100")));

/**
 * The worktree entry's blob id as `git add` would store it, and whether it is
 * a plain file; "other" for a folder and the like.
 */
async function worktreeEntry(root: string, path: string) {
  const info = await lstat(join(root, path)).catch(() => null);
  if (!info) return null;
  if (info.isSymbolicLink()) {
    // Git stores a link as its target text, unfiltered.
    const dir = await mkdtemp(join(tmpdir(), "relay-link-"));
    try {
      const text = join(dir, "link");
      await writeFile(text, await readlink(join(root, path), "buffer"));
      const id = await run(root, ["hash-object", "--no-filters", "--", text]);
      return { id: id.trim(), mode: "120000", file: false };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  if (info.isDirectory()) return { id: "other", mode: "040000", file: false };
  if (!info.isFile()) return { id: "other", mode: "other", file: false };
  const id = await run(root, [...noMonitor, "hash-object", "--", path]);
  return {
    id: id.trim(),
    mode: info.mode & 0o100 ? "100755" : "100644",
    file: true,
  };
}

/** Only explicitly deleted files may disappear when a directory becomes a file. */
async function canClearDirectory(
  root: string,
  path: string,
  deleted: Set<string>,
): Promise<boolean> {
  for (const entry of await readdir(join(root, path), {
    withFileTypes: true,
  })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!(await canClearDirectory(root, child, deleted))) return false;
    } else if (!deleted.has(child)) return false;
  }
  return true;
}

/** Drop empty directories only; never recursively remove files written meanwhile. */
async function clearEmptyDirectory(root: string, path: string): Promise<void> {
  const info = await lstat(join(root, path)).catch(() => null);
  if (!info?.isDirectory()) return;
  for (const entry of await readdir(join(root, path), { withFileTypes: true }))
    if (entry.isDirectory())
      await clearEmptyDirectory(root, `${path}/${entry.name}`);
  await rmdir(join(root, path));
}

/**
 * Plans moving files from how `from` has them to how `to` has them, keeping
 * edits made since: an untouched file is replaced, an edited one merged.
 */
export async function plan(
  root: string,
  paths: string[],
  from: string,
  to: string,
  force: boolean,
) {
  const steps: Step[] = [];
  const conflicts: string[] = [];
  const directories: string[] = [];
  const trustMode = await run(root, ["config", "--bool", "core.filemode"]).then(
    (value) => value.trim() !== "false",
    () => true,
  );
  // Each file starts up to three Git processes; thousands at once fail to spawn.
  await eachLimited(paths, 8, async (path) => {
    const [had, want, entry] = await Promise.all([
      blobEntry(root, from, path),
      blobEntry(root, to, path),
      worktreeEntry(root, path),
    ]);
    const directory = entry?.mode === "040000";
    const now = directory ? null : (entry ?? null);
    if (sameEntry(now, want, trustMode))
      return steps.push({ path, kind: "keep" });
    if (entry?.file && want?.mode.startsWith("100") && entry.id === want.id) {
      const mode = force || entry.mode === had?.mode ? want.mode : entry.mode;
      return steps.push(
        mode === entry.mode
          ? { path, kind: "keep" }
          : { path, kind: "mode", mode },
      );
    }
    const replace: Step = { path, kind: want ? "restore" : "delete" };
    if (force || sameEntry(now, had, trustMode)) {
      if (directory && want) directories.push(path);
      return steps.push(replace);
    }
    // Text and executable mode merge separately, so a later chmod survives
    // a content rollback and later text survives an executable-bit rollback.
    const contents =
      had?.mode.startsWith("100") && want?.mode.startsWith("100") && entry?.file
        ? await mergeBack(root, path, from, to, had.id === want.id)
        : null;
    if (contents) {
      const mode = entry!.mode === had!.mode ? want!.mode : entry!.mode;
      steps.push({
        path,
        kind: "merge",
        contents,
        ...(trustMode && mode !== entry!.mode ? { mode } : {}),
      });
    } else conflicts.push(path);
  });
  const deleted = new Set(
    steps.filter((step) => step.kind === "delete").map((step) => step.path),
  );
  for (const path of directories)
    if (!(await canClearDirectory(root, path, deleted))) conflicts.push(path);
  return { steps, conflicts: conflicts.sort() };
}

/** Keeps a durable preimage until writing succeeds; attempts recovery on failure. */
export async function apply(
  root: string,
  to: string,
  steps: Step[],
  before?: string,
) {
  if (steps.every((step) => step.kind === "keep")) return;
  before ??= await snapshot(root);
  const permissions = await fileModes(root, steps);
  const recoveryRef = `refs/relay/rewinds/${randomUUID()}`;
  await run(root, [...durable, "update-ref", recoveryRef, before]);
  try {
    await applySteps(root, to, steps, permissions);
  } catch (error) {
    try {
      const recovery = await plan(
        root,
        steps.map((step) => step.path),
        to,
        before,
        false,
      );
      if (recovery.conflicts.length)
        throw new Error(
          `Files changed meanwhile block recovery: ${recovery.conflicts.join(", ")}`,
        );
      await applySteps(root, before, recovery.steps, permissions);
    } catch (recoveryError) {
      throw new Error(
        `${errorMessage(error)}. Recovery also failed: ${errorMessage(recoveryError)}. The original files are kept at Git ref ${recoveryRef}.`,
        { cause: error },
      );
    }
    await run(root, ["update-ref", "-d", recoveryRef]);
    throw error;
  }
  await run(root, ["update-ref", "-d", recoveryRef]);
}

async function fileModes(root: string, steps: Step[]) {
  const modes = new Map<string, number>();
  await Promise.all(
    steps.map(async (step) => {
      const info = await lstat(join(root, step.path)).catch(() => null);
      if (info?.isFile()) modes.set(step.path, info.mode & 0o7777);
    }),
  );
  return modes;
}

/** Git records the owner's executable bit; leave unrelated permissions intact. */
function executableMode(mode: number, executable: boolean) {
  if (!!(mode & 0o100) === executable) return mode;
  return executable ? mode | ((mode & 0o444) >> 2) | 0o100 : mode & ~0o111;
}

async function applySteps(
  root: string,
  to: string,
  steps: Step[],
  permissions: Map<string, number>,
) {
  const restore = steps.filter((s) => s.kind === "restore").map((s) => s.path);
  if (restore.length) {
    // A scratch index checks files out of `to` with their modes and filters,
    // leaving the real index alone.
    const index = join(await mkdtemp(join(tmpdir(), "relay-rewind-")), "index");
    const env = { GIT_INDEX_FILE: index };
    try {
      await run(root, ["read-tree", to], env);
      await deleteSteps(root, steps);
      for (const path of restore) await clearEmptyDirectory(root, path);
      await checkOut(root, restore, env);
      for (const path of restore) {
        const mode = permissions.get(path);
        if (mode === undefined) continue;
        const info = await lstat(join(root, path));
        if (info.isFile())
          await chmod(
            join(root, path),
            executableMode(mode, !!(info.mode & 0o100)),
          );
      }
    } finally {
      await rm(dirname(index), { recursive: true, force: true });
    }
  } else await deleteSteps(root, steps);
  for (const step of steps) {
    if (step.kind === "merge") {
      await writeFile(join(root, step.path), step.contents);
    }
    if ((step.kind === "merge" || step.kind === "mode") && step.mode) {
      const path = join(root, step.path);
      const mode = (await stat(path)).mode & 0o7777;
      await chmod(path, executableMode(mode, step.mode === "100755"));
    }
  }
}

async function deleteSteps(root: string, steps: Step[]) {
  const deleted = steps
    .filter((step) => step.kind === "delete")
    .sort((a, b) => b.path.split("/").length - a.path.split("/").length);
  for (const step of deleted) {
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
  await apply(root, `${ref}^`, steps, before);
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
