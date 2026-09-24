import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectRepository } from "./repository";
import { git, gitBytes, gitEnv, redactCredentials } from "./git";
import { digest } from "./hash";
import { NotText, decodeText, readWorkingFile } from "./working-files";
import { parseNumstat } from "./turn-changes";
import {
  workingPathSchema,
  type WorkingTree,
  type GitAction,
  type ChangeArea,
  type WorkingChange,
} from "../shared/working-tree";
import type { Repo, FilePair } from "../shared/types";
export async function ignoredPaths(
  root: string,
  paths: string[],
): Promise<Set<string>> {
  if (!paths.length) return new Set();
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-C", root, "check-ignore", "--no-index", "--stdin", "-z"],
      {
        timeout: 15000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
        // check-ignore rejects literal pathspec magic outright.
        env: gitEnv({ GIT_LITERAL_PATHSPECS: undefined }),
      },
      (error, stdout) => {
        if (error && Number(error.code) !== 1) reject(error);
        else resolve(new Set(stdout.split("\0").filter(Boolean)));
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(paths.join("\0") + "\0");
  });
}
export async function gitOperation(root: string): Promise<string | null> {
  const dir = (await git(root, ["rev-parse", "--absolute-git-dir"])).trim();
  const names = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
  ];
  const entries = await Promise.all(
    names.map((name) =>
      lstat(join(dir, name)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
        return null;
      }),
    ),
  );
  return names.find((_, i) => !!entries[i]) ?? null;
}
export async function validateRepo(root: string, server: string, repo: Repo) {
  const local = await inspectRepository(root, server, repo);
  if (!local.remoteMatches)
    throw new Error(
      "The linked folder’s remote no longer matches this project. Relink the correct folder.",
    );
  return local.path;
}
export function parseStatus(raw: string): WorkingChange[] {
  const entries = raw.split("\0"),
    result: WorkingChange[] = [];
  for (let i = 0; i < entries.length; i++) {
    const row = entries[i];
    if (!row) continue;
    const index = row[0],
      worktree = row[1],
      path = row.slice(3);
    const previousPath = /[RC]/.test(index + worktree)
      ? entries[++i]
      : undefined;
    const conflict =
      /U/.test(index + worktree) || ["AA", "DD"].includes(index + worktree);
    result.push({ path, previousPath, index, worktree, conflict });
  }
  return result;
}
export async function pushDestination(root: string, branch: string) {
  if (!branch) return null;
  const config = (key: string) =>
    git(root, ["config", "--get", `branch.${branch}.${key}`]).then(
      (out) => out.trim(),
      () => "",
    );
  const [remote, merge, remotes] = await Promise.all([
    config("remote").then((value) => value || "origin"),
    config("merge").then((value) => value || `refs/heads/${branch}`),
    git(root, ["remote"]).then((out) => out.trim().split("\n")),
  ]);
  if (!remotes.includes(remote) || !merge.startsWith("refs/heads/"))
    return null;
  const url = (await git(root, ["remote", "get-url", "--push", remote])).trim();
  return { remote, url, ref: merge, label: `${remote}/${merge.slice(11)}` };
}
async function fetchUpstream(root: string, branch: string) {
  // Detached or local-only branches have nothing to fetch.
  const remote = branch
    ? (
        await git(root, ["config", "--get", `branch.${branch}.remote`]).catch(
          () => "",
        )
      ).trim()
    : "";
  if (!remote || remote === ".") return;
  await git(root, ["fetch", "--prune", "--quiet", remote], 60000);
}
const untrackedLimit = 200,
  untrackedBytes = 1024 * 1024;
// The tree is polled every few seconds and untracked files rarely change
// between polls, so their line counts are kept per checkout by size and mtime.
const untrackedCache = new Map<string, Map<string, number>>();
/** Lines added and removed across the checkout against HEAD, untracked text files included. */
async function lineCounts(root: string, changes: WorkingChange[]) {
  const untracked = changes
    .filter((c) => c.index === "?")
    .slice(0, untrackedLimit);
  const previous = untrackedCache.get(root),
    seen = new Map<string, number>();
  const [diff, added] = await Promise.all([
    untracked.length === changes.length
      ? ""
      : git(root, [
          "diff",
          "HEAD",
          "--numstat",
          "-z",
          "--no-renames",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
        ]),
    Promise.all(
      untracked.map((c) => untrackedLines(join(root, c.path), previous, seen)),
    ),
  ]);
  if (seen.size) untrackedCache.set(root, seen);
  else untrackedCache.delete(root);
  const tracked = parseNumstat(diff);
  return {
    additions:
      tracked.reduce((sum, f) => sum + f.additions, 0) +
      added.reduce((sum, n) => sum + n, 0),
    deletions: tracked.reduce((sum, f) => sum + f.deletions, 0),
  };
}
async function untrackedLines(
  path: string,
  previous: Map<string, number> | undefined,
  seen: Map<string, number>,
) {
  const s = await lstat(path).catch(() => null);
  if (!s?.isFile() || !s.size || s.size > untrackedBytes) return 0;
  const key = `${path}\0${s.size}\0${s.mtimeMs}`;
  let lines = previous?.get(key);
  if (lines === undefined) {
    const bytes = await readFile(path).catch(() => null);
    // Git counts a file with a NUL byte as binary, with no lines.
    lines = 0;
    if (bytes && !bytes.includes(0)) {
      for (let i = bytes.indexOf(10); i !== -1; i = bytes.indexOf(10, i + 1))
        lines++;
      if (bytes[bytes.length - 1] !== 10) lines++;
    }
  }
  seen.set(key, lines);
  return lines;
}
export async function workingTree(root: string): Promise<WorkingTree> {
  // This runs every few seconds and around every Git action, so reads that
  // don't depend on each other run together (status takes no index lock).
  const [headRaw, branchRaw, raw, upstream, operation] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["branch", "--show-current"]),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(root, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]).then(
      (out) => out.trim() || null,
      () => null,
    ),
    gitOperation(root),
  ]);
  const head = headRaw.trim(),
    branch = branchRaw.trim(),
    // Paths Relay can't open, such as a nested repository's "inner/", stay
    // out of the list instead of failing it.
    changes = parseStatus(raw).filter(
      (c) => workingPathSchema.safeParse(c.path).success,
    );
  // Staging the status line doesn't show (such as `git add -p`) only happens
  // on changed paths. The whole index is megabytes in a large repository.
  const tracked = changes.filter((c) => c.index !== "?").map((c) => c.path);
  const [index, stamps, destination, counts, log, lines] = await Promise.all([
    tracked.length
      ? git(root, [
          "ls-files",
          "--stage",
          "-z",
          ...(tracked.length > 1000 ? [] : ["--", ...tracked]),
        ])
      : "",
    Promise.all(
      changes.map(async (c) => {
        const s = await lstat(join(root, c.path)).catch(
          (e: NodeJS.ErrnoException) => {
            if (e.code !== "ENOENT") throw e;
            return null;
          },
        );
        return s
          ? [c.path, s.size, s.mtimeMs, s.ctimeMs, s.ino, s.mode]
          : [c.path, null];
      }),
    ),
    pushDestination(root, branch),
    upstream
      ? git(root, [
          "rev-list",
          "--left-right",
          "--count",
          `${upstream}...HEAD`,
        ]).then((out) => out.trim().split(/\s+/).map(Number))
      : [0, 0],
    upstream
      ? git(root, ["log", "-30", "--format=%H %s", `${upstream}..HEAD`])
      : "",
    lineCounts(root, changes),
  ]);
  return {
    head,
    branch,
    changes,
    upstream,
    ahead: counts[1],
    behind: counts[0],
    operation,
    lines,
    pushTarget: destination?.label ?? null,
    pushUrl: destination ? redactCredentials(destination.url) : null,
    outgoing: log
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((r) => ({
        sha: r.slice(0, r.indexOf(" ")),
        subject: r.slice(r.indexOf(" ") + 1),
      })),
    revision: digest(
      JSON.stringify([head, branch, raw, index, stamps, upstream, destination]),
    ),
  };
}
const queue = new Map<string, Promise<unknown>>();
export async function flushGitOperations() {
  await Promise.allSettled([...queue.values()]);
}
export async function serializeRepo<T>(
  root: string,
  run: () => Promise<T>,
): Promise<T> {
  const before = queue.get(root);
  const task = (async () => {
    await before?.catch(() => {});
    return run();
  })();
  queue.set(root, task);
  try {
    return await task;
  } finally {
    if (queue.get(root) === task) queue.delete(root);
  }
}
function withPreviousPaths(
  changes: WorkingChange[],
  paths: string[],
  includePrevious: (c: WorkingChange) => boolean,
) {
  return [
    ...new Set(
      paths.flatMap((path) => {
        const c = changes.find((c) => c.path === path);
        if (!c)
          throw new Error("That file is no longer changed. Refresh first.");
        return c.previousPath && includePrevious(c)
          ? [path, c.previousPath]
          : [path];
      }),
    ),
  ];
}
export async function performGitAction(root: string, action: GitAction) {
  return serializeRepo(root, async () => {
    const state = await workingTree(root);
    if (action.kind === "fetch") {
      // Background refresh of the upstream so "behind" reflects the remote.
      if (!state.upstream) return state;
      await fetchUpstream(root, state.branch);
      return workingTree(root);
    }
    if (action.revision !== state.revision)
      throw new Error(
        "Your checkout changed. Review the refreshed changes and try again.",
      );
    if (action.kind === "stage" || action.kind === "unstage") {
      const allPaths = withPreviousPaths(
        state.changes,
        action.paths,
        (c) => action.kind === "unstage" || /[RC]/.test(c.worktree),
      );
      // Bounded chunks avoid argv limits; use literal paths even for names containing Git magic.
      for (let i = 0; i < allPaths.length; i += 100)
        await git(
          root,
          action.kind === "stage"
            ? ["add", "--", ...allPaths.slice(i, i + 100)]
            : ["reset", "-q", "HEAD", "--", ...allPaths.slice(i, i + 100)],
        );
    } else {
      if (!state.branch || state.operation)
        throw new Error(
          "Finish the current Git operation on a branch before committing or pushing here.",
        );
      if (state.changes.some((c) => c.conflict))
        throw new Error("Resolve and stage all merge conflicts first.");
      if (action.kind === "commit" && action.paths) {
        // Both sides of a rename, so its old path is committed as removed.
        const paths = withPreviousPaths(
          state.changes,
          action.paths,
          () => true,
        );
        // New and deleted files must be in the index before `commit --only` sees them.
        await git(root, ["add", "--", ...paths]);
        await git(
          root,
          ["commit", "--only", "-m", action.message, "--", ...paths],
          120000,
        );
      } else if (action.kind === "commit") {
        if (!state.changes.some((c) => c.index !== " " && c.index !== "?"))
          throw new Error("Stage the changes you want to commit first.");
        await git(root, ["commit", "-m", action.message], 120000);
      } else if (action.kind === "pull") {
        if (!state.upstream)
          throw new Error("This branch has no upstream to pull from.");
        await fetchUpstream(root, state.branch);
        const [, ahead] = (
          await git(root, [
            "rev-list",
            "--left-right",
            "--count",
            "@{upstream}...HEAD",
          ])
        )
          .trim()
          .split(/\s+/)
          .map(Number);
        if (ahead > 0)
          throw new Error(
            "This branch has diverged from its upstream. Rebase or merge it yourself first.",
          );
        // Fast-forward only: never create a merge commit or rebase behind the user's back.
        await git(
          root,
          ["merge", "--ff-only", "--quiet", "@{upstream}"],
          120000,
        );
      } else {
        const target = await pushDestination(root, state.branch);
        if (!target)
          throw new Error("Configure a Git push remote for this branch first.");
        await git(
          root,
          [
            "push",
            "--porcelain",
            "--set-upstream",
            target.remote,
            `HEAD:${target.ref}`,
          ],
          120000,
        );
      }
    }
    return workingTree(root);
  });
}
export async function workingDiff(
  root: string,
  path: string,
  area: ChangeArea,
): Promise<FilePair> {
  workingPathSchema.parse(path);
  const state = await workingTree(root),
    c = state.changes.find((c) => c.path === path);
  if (!c) throw new Error("This file no longer has local changes.");
  if (c.conflict)
    throw new Error(
      "This file has merge conflicts. Resolve them in your editor, then stage the result.",
    );
  const fromGit = async (spec: string, name: string, absent: boolean) =>
    absent
      ? null
      : {
          name,
          contents: decodeText(await gitBytes(root, ["show", spec])),
          cacheKey: "",
        };
  const oldName = c.previousPath ?? path;
  let old: FilePair["old"], next: FilePair["next"];
  try {
    old =
      area === "staged"
        ? await fromGit(
            `HEAD:${oldName}`,
            oldName,
            c.index === "A" || c.index === "?",
          )
        : await fromGit(`:${path}`, path, c.index === "?" || c.index === "D");
    if (area === "staged")
      next = await fromGit(`:${path}`, path, c.index === "D");
    else if (c.worktree === "D") next = null;
    else {
      // The shared safe reader rejects symlink parents and hardlinks.
      const value = await readWorkingFile(root, path);
      next = value
        ? { name: path, contents: value.contents, cacheKey: value.hash }
        : null;
    }
  } catch (e) {
    if (e instanceof NotText) return { old: null, next: null, binary: true };
    throw e;
  }
  for (const f of [old, next]) if (f) f.cacheKey ||= digest(f.contents);
  return { old, next, binary: false };
}
