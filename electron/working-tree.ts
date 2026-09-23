import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { inspectRepository } from "./repository";
import { git, gitBytes, gitEnv, redactCredentials } from "./git";
import { digest } from "./hash";
import { decodeText, readWorkingFile } from "./working-files";
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
async function pushDestination(root: string, branch: string) {
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
    changes = parseStatus(raw);
  for (const c of changes) workingPathSchema.parse(c.path);
  // Staging the status line doesn't show (such as `git add -p`) only happens
  // on changed paths. The whole index is megabytes in a large repository.
  const tracked = changes.filter((c) => c.index !== "?").map((c) => c.path);
  const [index, stamps, destination, counts, log] = await Promise.all([
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
  ]);
  return {
    head,
    branch,
    changes,
    upstream,
    ahead: counts[1],
    behind: counts[0],
    operation,
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
      const paths = [...new Set(action.paths)];
      for (const path of paths)
        if (!state.changes.some((c) => c.path === path))
          throw new Error("That file is no longer changed. Refresh first.");
      const allPaths = [
        ...new Set(
          paths.flatMap((path) => {
            const c = state.changes.find((c) => c.path === path)!;
            return c.previousPath &&
              (action.kind === "unstage" || /[RC]/.test(c.worktree))
              ? [path, c.previousPath]
              : [path];
          }),
        ),
      ];
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
      if (action.kind === "commit") {
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
  const old =
    area === "staged"
      ? await fromGit(
          `HEAD:${oldName}`,
          oldName,
          c.index === "A" || c.index === "?",
        )
      : await fromGit(`:${path}`, path, c.index === "?" || c.index === "D");
  let next: FilePair["next"];
  if (area === "staged")
    next = await fromGit(`:${path}`, path, c.index === "D");
  else if (c.worktree === "D") next = null;
  else {
    // The shared safe reader rejects symlink parents, hardlinks, binary and oversized files.
    const value = await readWorkingFile(root, path);
    next = value
      ? { name: path, contents: value.contents, cacheKey: value.hash }
      : null;
  }
  for (const f of [old, next])
    if (f) {
      if (
        Buffer.byteLength(f.contents) > 2 * 1024 * 1024 ||
        f.contents.includes("\0")
      )
        return { old: null, next: null, binary: true };
      f.cacheKey ||= digest(f.contents);
    }
  return { old, next, binary: false };
}
