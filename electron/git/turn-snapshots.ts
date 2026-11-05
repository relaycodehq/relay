import { randomUUID } from "node:crypto";
import { copyFile, readdir, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { exitCodeOf, git, nulSeparated } from "./git";

// Snapshots of a whole worktree as commits outside any branch, made without
// touching the real index.
const identity = {
  GIT_AUTHOR_NAME: "Relay",
  GIT_AUTHOR_EMAIL: "relay@localhost",
  GIT_COMMITTER_NAME: "Relay",
  GIT_COMMITTER_EMAIL: "relay@localhost",
};

// Git renames objects and refs into place without fsync by default, so an
// unclean restart could leave empty files under refs/relay that break fetches.
export const durable = [
  "-c",
  "core.fsync=objects,reference",
  "-c",
  "core.fsyncMethod=fsync",
];

export const noMonitor = ["-c", "core.fsmonitor=false"];

/** Snapshots walk the whole worktree, so they get twice Git's usual time. */
export const run = (
  root: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  polled = false,
) => git(root, args, { timeout: 30000, env, polled });

/**
 * Writes `paths` out of the index `env` points Git at. They go through stdin:
 * hundreds of them overflow Windows' 32k command line.
 */
export const checkOut = (
  root: string,
  paths: string[],
  env: NodeJS.ProcessEnv,
) =>
  git(root, ["checkout-index", "-f", "-z", "--stdin"], {
    timeout: 30000,
    env,
    input: nulSeparated(paths),
  });

/**
 * Writes the worktree's tree, untracked files included, without touching the
 * real index. A `whole` one fails rather than leave out anything that holds
 * work; a `polled` one is Relay's own look, which the repository's filters
 * stay out of.
 */
export async function snapshotTree(
  root: string,
  { whole = false, polled = false } = {},
) {
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
      if (head) await run(root, ["read-tree", "HEAD"], env, polled);
    }
    // A folder Git can't add, like a nested repository with no commits yet,
    // is left out (exit code 1) rather than failing the whole snapshot.
    const leftOut = await run(
      root,
      [...noMonitor, ...durable, "add", "-A", "--ignore-errors", "--", "."],
      env,
      polled,
    ).then(
      () => false,
      (error: unknown) => {
        if (exitCodeOf(error) !== 1) throw error;
        return true;
      },
    );
    if (whole && leftOut) await assertNothingLeftOut(root, env);
    // write-tree may run the clean filter too.
    return (
      await run(root, [...noMonitor, ...durable, "write-tree"], env, polled)
    ).trim();
  } finally {
    await rm(temp, { force: true });
    await rm(`${temp}.lock`, { force: true });
  }
}

/**
 * Throws when what `add` left out of the index `env` points at holds work:
 * a file, or a nested repository with more in it than its own `.git`.
 */
async function assertNothingLeftOut(root: string, env: NodeJS.ProcessEnv) {
  const status = await run(
    root,
    ["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all"],
    env,
  );
  const lost: string[] = [];
  for (const entry of status.split("\0").filter(Boolean)) {
    // The second letter is the worktree against the index: blank once added.
    const added = entry[1] === " ";
    const path = entry.slice(3);
    if (!added && (await holdsWork(join(root, path)))) lost.push(path);
  }
  if (lost.length) throw new Error(`Git couldn't copy ${lost.join(", ")}.`);
}

/** A file, or a folder with anything besides its own `.git`; one that can't be read counts. */
async function holdsWork(path: string) {
  const names = await readdir(path).catch(() => undefined);
  return !names || names.some((name) => name !== ".git");
}

/** Commits a tree as Relay, outside any branch. */
export async function commitTree(
  root: string,
  tree: string,
  parent: string | undefined,
  message: string,
) {
  return (
    await run(
      root,
      [
        ...durable,
        "commit-tree",
        tree,
        ...(parent ? ["-p", parent] : []),
        "-m",
        message,
      ],
      identity,
    )
  ).trim();
}

/** Commits the worktree, untracked files included, without touching the real index. */
export async function snapshot(root: string, parent?: string) {
  return commitTree(
    root,
    await snapshotTree(root),
    parent,
    "Relay turn snapshot",
  );
}
