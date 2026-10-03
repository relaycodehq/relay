import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { git } from "./git";
import { moveCheckout, replayOnto } from "./branch-rebase";
import { serializeRepo } from "./working-tree";
import { repoOf, remoteUrl } from "./repository";
import { needsFullBundle } from "../../shared/handoff";

/**
 * The Git side of handing a thread between computers: the work is committed
 * on its worktree branch and travels as a bundle, which holds only the
 * commits the other side can't already have from the shared remote.
 */

/** Commits everything in the worktree, untracked files included; ignored ones stay. */
export async function commitEverything(path: string, message: string) {
  const status = await git(path, ["status", "--porcelain"]);
  if (!status.trim()) return false;
  await git(path, ["add", "-A"], 60_000);
  const identity = await git(path, ["config", "user.email"]).then(
    (s) => s.trim(),
    () => "",
  );
  // A computer nobody configured Git on still hands work back.
  const fallback = identity
    ? []
    : ["-c", "user.name=Relay", "-c", "user.email=relay@localhost"];
  // Hooks would lint half-done work; this commit only carries it across.
  await git(
    path,
    [...fallback, "commit", "--no-verify", "-q", "-m", message],
    60_000,
  );
  return true;
}

export const headOf = async (path: string) =>
  (await git(path, ["rev-parse", "HEAD"])).trim();

/** `owner/name` of the repository's remotes, `origin` first; empty for a local-only one. */
export async function repositoryNames(path: string): Promise<string[]> {
  const remotes = (await git(path, ["remote"]).catch(() => ""))
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean)
    .sort((a, b) => (a === "origin" ? -1 : b === "origin" ? 1 : 0));
  const names: string[] = [];
  for (const remote of remotes) {
    const url = (
      await git(path, ["remote", "get-url", remote]).catch(() => "")
    ).trim();
    // A remote on disk, e.g. a bare repository on a shared drive, is a path.
    const parsed = isAbsolute(url)
      ? new URL(pathToFileURL(url).href)
      : remoteUrl(url);
    const repo = parsed && repoOf(parsed);
    // Hosts differ between computers (SSH aliases), so only the path counts.
    const name = repo && `${repo.owner}/${repo.name}`.toLowerCase();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Whether a remote-tracking branch already has the commit, so the other side can fetch it there. */
async function onRemote(path: string, commit: string) {
  const branches = await git(path, [
    "branch",
    "-r",
    "--contains",
    commit,
  ]).catch(() => "");
  return !!branches.trim();
}

/**
 * Bundles `branch` into `file`: only what no remote-tracking branch has, or
 * its whole history when `full`, or `false` when there's nothing to send.
 */
export async function bundleBranch(
  path: string,
  branch: string,
  file: string,
  { full = false, since }: { full?: boolean; since?: string } = {},
) {
  const tip = (await git(path, ["rev-parse", `refs/heads/${branch}`])).trim();
  if (since === tip) return false;
  if (!full && !since && (await onRemote(path, tip))) return false;
  const limit = full ? [] : since ? [`^${since}`] : ["--not", "--remotes"];
  await git(
    path,
    ["bundle", "create", "-q", file, `refs/heads/${branch}`, ...limit],
    300_000,
  );
  return (await stat(file)).size;
}

/**
 * Brings the bundle's branch into `root` as `ref`, after checking this
 * repository has what the bundle builds on. A missing base asks for the full
 * history instead.
 */
export async function fetchBundle(
  root: string,
  file: string,
  branch: string,
  ref: string,
) {
  await git(root, ["bundle", "verify", "-q", file], 120_000).catch(() => {
    throw new Error(needsFullBundle);
  });
  await git(
    root,
    ["fetch", "-q", "--no-tags", file, `+refs/heads/${branch}:${ref}`],
    300_000,
  );
  return (await git(root, ["rev-parse", ref])).trim();
}

/** Whether the repository holds the commit, e.g. after fetching the remote. */
export const hasCommit = (root: string, commit: string) =>
  git(root, ["cat-file", "-e", `${commit}^{commit}`]).then(
    () => true,
    () => false,
  );

const isAncestor = (root: string, a: string, b: string) =>
  git(root, ["merge-base", "--is-ancestor", a, b]).then(
    () => true,
    () => false,
  );

/**
 * Brings work that came back at `tip` into the worktree at `path`. When the
 * worktree moved on meanwhile, the returned commits are replayed on top of
 * it; the files they clash on when they can't be, and nothing moves then.
 */
export function landReturned(
  path: string,
  tip: string,
  from: string,
): Promise<string[]> {
  return serializeRepo(path, async () => {
    const head = await headOf(path);
    if (head === tip || (await isAncestor(path, tip, head))) return [];
    if (await isAncestor(path, head, tip)) {
      await git(path, ["merge", "--ff-only", "-q", tip], 60_000);
      return [];
    }
    const replayed = await replayOnto(path, tip, head);
    if ("conflicts" in replayed) return replayed.conflicts;
    await moveCheckout(path, head, replayed.sha, `handoff: back from ${from}`);
    return [];
  });
}

/** Catches the remote-tracking branches up; best effort, the bundle may carry everything anyway. */
export const fetchRemotes = (root: string) =>
  git(root, ["fetch", "-q", "--all", "--no-tags"], 120_000).catch(() => {});
