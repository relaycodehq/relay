// What a working-tree refresh needs besides `git status`, read without
// running Git where the answer is on disk, and kept while what it came from
// is unchanged. Nothing here is kept for a time: every value is checked
// against the files it was read from, so a refresh never shows a stale one.
import { lstat, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { git } from "./git";

interface GitDirs {
  /** This checkout's own Git folder; a linked worktree's is under the main one. */
  gitDir: string;
  /** The folder its worktrees share: config, refs and objects. */
  commonDir: string;
}

const dirs = new Map<string, Promise<GitDirs>>();

/** Where `root`'s Git folders are: asked of Git once, then only checked to still be there. */
export async function gitDirs(root: string): Promise<GitDirs> {
  const known = dirs.get(root);
  if (known) {
    const found = await known.catch(() => null);
    if (found && (await lstat(found.gitDir).catch(() => null))) return found;
    dirs.delete(root);
  }
  const asked = git(root, [
    "rev-parse",
    "--path-format=absolute",
    "--absolute-git-dir",
    "--git-common-dir",
  ]).then((out) => {
    const [gitDir, commonDir] = out.trim().split("\n");
    return { gitDir: gitDir!, commonDir: commonDir || gitDir! };
  });
  asked.catch(() => dirs.delete(root));
  dirs.set(root, asked);
  return asked;
}

const mtime = (path: string) =>
  stat(path).then(
    (s) => s.mtimeMs,
    () => 0,
  );

/**
 * Changes when a setting `git push` reads may have: the repository's config
 * and the user's. A file another one includes isn't followed.
 */
export async function configStamp(root: string) {
  const { gitDir, commonDir } = await gitDirs(root);
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const files = [
    join(commonDir, "config"),
    join(gitDir, "config.worktree"),
    process.env.GIT_CONFIG_GLOBAL || join(homedir(), ".gitconfig"),
    join(xdg, "git", "config"),
  ];
  return (await Promise.all(files.map(mtime))).join(":");
}

/**
 * Changes when the remote-tracking refs of `remote` may have: a fetch writes
 * FETCH_HEAD, a push the ref it pushed (`ref`, as `refs/heads/x`, is the one
 * a push of this branch writes), packing `packed-refs`. A push of some other
 * branch with a `/` in its name only touches its own folder, so the stamp
 * misses it until the next fetch.
 */
export async function remoteRefsStamp(
  root: string,
  remote: string,
  ref: string,
) {
  const { commonDir } = await gitDirs(root);
  const files = [
    join(commonDir, "FETCH_HEAD"),
    join(commonDir, "packed-refs"),
    join(commonDir, "reftable"),
    join(commonDir, "refs", "remotes", remote),
    join(
      commonDir,
      "refs",
      "remotes",
      remote,
      ref.replace(/^refs\/heads\//, ""),
    ),
  ];
  return (await Promise.all(files.map(mtime))).join(":");
}

/** Keeps one value per checkout for as long as `key` stays the same. */
export function memo<T>() {
  const kept = new Map<string, { key: string; value: Promise<T> }>();
  const forget = (root: string, value: Promise<T>) => {
    if (kept.get(root)?.value === value) kept.delete(root);
  };
  const read = (root: string, key: string, read: () => Promise<T>) => {
    const last = kept.get(root);
    if (last?.key === key) return last.value;
    const value = read();
    kept.set(root, { key, value });
    // A failed read is asked again next time rather than kept.
    value.catch(() => forget(root, value));
    return value;
  };
  /** Drops `value` if it's still the one kept, for an answer that was only partial. */
  read.forget = forget;
  return read;
}
