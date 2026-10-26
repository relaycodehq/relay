import { chunks } from "../util/chunks";
import { keyedQueue } from "../util/keyed-queue";
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectRepository } from "./repository";
import { git, gitEnv, gitError, gitExecutable, redactCredentials } from "./git";
import { digest } from "../util/hash";
import { ignoredTouches } from "./ignored-touches";
import { configStamp, gitDirs, memo, remoteRefsStamp } from "./repo-facts";
import { parseStatusV2, statusArgs } from "./working-status";
import {
  workingPathSchema,
  type WorkingTree,
  type WorkingChange,
} from "../../shared/working-tree";
import type { Repo } from "../../shared/types";
import { headlineStat, statsByKind } from "../../shared/diff-kinds";

/** The rule ignoring each of `paths`, as `.gitignore:4 .env*.local`; paths no rule ignores are left out. */
export async function ignoreRules(root: string, paths: string[]) {
  const fields = (await checkIgnore(root, paths)).split("\0");
  const rules = new Map<string, string>();
  // Four fields a path: source, line, pattern, path. A negated rule (`!x`) un-ignores.
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [source, line, pattern, path] = fields.slice(i, i + 4);
    if (source && !pattern.startsWith("!"))
      rules.set(path, `${source}:${line} ${pattern}`);
  }
  return rules;
}

async function checkIgnore(root: string, paths: string[]) {
  if (!paths.length) return "";
  const file = await gitExecutable();
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      file,
      ["-C", root, "check-ignore", "-v", "--no-index", "--stdin", "-z"],
      {
        timeout: 15000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
        // check-ignore rejects literal pathspec magic outright.
        env: gitEnv({ GIT_LITERAL_PATHSPECS: undefined }),
      },
      (error, stdout) => {
        if (error && Number(error.code) !== 1) reject(gitError(error));
        else resolve(stdout);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(paths.join("\0") + "\0");
  });
}

export async function gitOperation(root: string): Promise<string | null> {
  const dir = (await gitDirs(root)).gitDir;
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

/**
 * Where `git push` would send the branch: its push remote (`pushRemote`, then
 * `remote.pushDefault`) or else the remote it tracks, under the branch's own
 * name. Only `push.default=upstream` follows an upstream of another name, so a
 * `feature` made from origin/main goes to origin/feature, not onto main.
 * `tracks` says the push goes where the branch fetches from, so pushing may
 * set its upstream.
 */
async function readPushDestination(root: string, branch: string) {
  // One read of all settings rather than a Git run per key. Section and key names come lowercased, branch and
  // remote names as written; a later value wins, as with `config --get`.
  const settings = new Map<string, string>();
  const listed = await git(root, ["config", "-z", "--list"]).catch(() => "");
  for (const entry of listed.split("\0")) {
    const at = entry.indexOf("\n");
    if (entry)
      settings.set(
        at < 0 ? entry : entry.slice(0, at),
        at < 0 ? "" : entry.slice(at + 1).trim(),
      );
  }
  const config = (key: string) => settings.get(key) ?? "";
  const fetched = config(`branch.${branch}.remote`) || "origin",
    pushTo = config(`branch.${branch}.pushremote`),
    pushDefault = config("remote.pushdefault"),
    merge = config(`branch.${branch}.merge`),
    mode = config("push.default");
  const remotes = [...settings.keys()]
    .filter((key) => key.startsWith("remote."))
    .map((key) => key.slice(7, key.lastIndexOf(".")))
    .filter(Boolean);
  const remote = pushTo || pushDefault || fetched;
  const tracks = remote === fetched;
  const followsUpstream = mode === "upstream" || mode === "tracking";
  const ref =
    tracks && merge && followsUpstream ? merge : `refs/heads/${branch}`;
  if (!remotes.includes(remote) || !ref.startsWith("refs/heads/")) return null;
  const url = (await git(root, ["remote", "get-url", "--push", remote])).trim();
  return { remote, url, ref, tracks, label: `${remote}/${ref.slice(11)}` };
}

export async function pushDestination(root: string, branch: string) {
  if (!branch) return null;
  return destinations(root, `${branch}\0${await configStamp(root)}`, () =>
    readPushDestination(root, branch),
  );
}

export async function fetchUpstream(root: string, branch: string) {
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

// Untracked files read for their line counts in one refresh; the rest are
// read by the next ones, so a big batch of new files adds up over a few polls.
const untrackedBytesPerRefresh = 32 * 1024 * 1024,
  // Bigger untracked files are left out of the count.
  untrackedFileBytes = 16 * 1024 * 1024;
// The tree is polled every few seconds and untracked files rarely change
// between polls, so their line counts are kept per checkout by size and mtime.
const untrackedCache = new Map<string, Map<string, number>>();
// A repository with no commits yet is compared with the empty tree.
const trackedBase = async (root: string, head: string) =>
  head || (await git(root, ["hash-object", "-t", "tree", "/dev/null"])).trim();
/** Each changed file's lines against HEAD, untracked text files included. */
async function changedFiles(
  root: string,
  changes: WorkingChange[],
  head: string,
) {
  const untracked = changes.filter((c) => c.index === "?");
  const [diff, untrackedFiles] = await Promise.all([
    untracked.length === changes.length
      ? ""
      : trackedBase(root, head).then((base) =>
          git(root, [
            "diff",
            base,
            "--numstat",
            "-z",
            // A rename counts as the lines it changed, as its commit will.
            "-M",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
          ]),
        ),
    untrackedLines(
      root,
      untracked.map((c) => c.path),
    ),
  ]);
  return {
    files: [...numstatFiles(diff), ...untrackedFiles.files],
    partial: untrackedFiles.partial,
  };
}

/**
 * Lines added and removed across the checkout against HEAD, untracked text
 * files included and generated ones (lockfiles) left out.
 */
async function lineCounts(
  root: string,
  changes: WorkingChange[],
  head: string,
) {
  const { files, partial } = await changedFiles(root, changes, head);
  const by = statsByKind(files);
  const lines = headlineStat(by);
  return {
    lines:
      lines === by.generated ||
      !(by.generated.additions || by.generated.deletions)
        ? lines
        : { ...lines, generated: by.generated },
    partial,
  };
}

/** Each file changed in the checkout, with its lines against HEAD. */
export async function uncommittedFiles(root: string) {
  const status = parseStatusV2(await git(root, statusArgs));
  return (await changedFiles(root, status.changes, status.head)).files;
}

/** Reads `--numstat -z` output, where a rename's paths follow its counts as two more fields. */
export function numstatFiles(output: string) {
  const fields = output.split("\0");
  const files: { path: string; additions: number; deletions: number }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const row = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(fields[i]);
    if (!row) continue;
    const path = row[3] || fields[(i += 2)] || "";
    files.push({
      path,
      additions: Number(row[1]) || 0,
      deletions: Number(row[2]) || 0,
    });
  }
  return files;
}

async function untrackedLines(root: string, paths: string[]) {
  const previous = untrackedCache.get(root),
    seen = new Map<string, number>();
  let budget = untrackedBytesPerRefresh,
    partial = false;
  const files: { path: string; additions: number; deletions: number }[] = [];
  for (const part of chunks(paths, 64)) {
    const stats = await Promise.all(
      part.map((path) => lstat(join(root, path)).catch(() => null)),
    );
    const counts = await Promise.all(
      part.map(async (path, i) => {
        const s = stats[i];
        if (!s?.isFile() || !s.size || s.size > untrackedFileBytes) return 0;
        const key = `${path}\0${s.size}\0${s.mtimeMs}`;
        let lines = previous?.get(key);
        if (lines === undefined) {
          if (s.size > budget) {
            partial = true;
            return 0;
          }
          budget -= s.size;
          lines = textLines(await readFile(join(root, path)).catch(() => null));
        }
        seen.set(key, lines);
        return lines;
      }),
    );
    part.forEach((path, i) =>
      files.push({ path, additions: counts[i], deletions: 0 }),
    );
  }
  if (seen.size) untrackedCache.set(root, seen);
  else untrackedCache.delete(root);
  return { files, partial };
}

function textLines(bytes: Buffer | null) {
  // Git counts a file with a NUL byte as binary, with no lines.
  if (!bytes?.length || bytes.includes(0)) return 0;
  let lines = 0;
  for (let i = bytes.indexOf(10); i !== -1; i = bytes.indexOf(10, i + 1))
    lines++;
  return bytes[bytes.length - 1] === 10 ? lines : lines + 1;
}

// Each is read again only when what it depends on changed: a refresh while
// an agent edits files runs `git status` and, for the line counts, `git diff`.
const destinations = memo<Awaited<ReturnType<typeof readPushDestination>>>();
const counted = memo<Awaited<ReturnType<typeof lineCounts>>>();
const outgoingLog = memo<string>();
const unpushed = memo<number>();

/**
 * The checkout as the Changes pane shows it. Runs often (on every change the
 * watch sees, and around every Git action), so it asks Git once and reads the
 * rest from disk or from what the last refresh already found.
 */
export async function workingTree(root: string): Promise<WorkingTree> {
  const [raw, operation] = await Promise.all([
    git(root, statusArgs),
    gitOperation(root),
  ]);
  const status = parseStatusV2(raw);
  const { head, branch } = status;
  // Paths Relay can't open, such as a nested repository's "inner/", stay
  // out of the list instead of failing it.
  const opened = status.changes.flatMap((c, i) =>
    workingPathSchema.safeParse(c.path).success
      ? [{ c, row: status.rows[i]! }]
      : [],
  );
  // Git compares with the upstream only when it exists and HEAD has a commit;
  // on a branch with none yet, everything upstream is behind.
  const unbornBehind =
    !head && status.upstream
      ? await git(root, ["rev-list", "--count", status.upstream]).then(
          (out) => Number(out.trim()),
          () => null,
        )
      : null;
  const upstream = status.ab || unbornBehind !== null ? status.upstream : null;
  const [stamps, destination, ignored] = await Promise.all([
    Promise.all(
      opened.map(async ({ c, row }) => {
        const s = await lstat(join(root, c.path)).catch(
          (e: NodeJS.ErrnoException) => {
            // ENOTDIR: a tracked folder was replaced by a file of its name.
            if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
            return null;
          },
        );
        return [
          row,
          ...(s ? [s.size, s.mtimeMs, s.ctimeMs, s.ino, s.mode] : [null]),
        ];
      }),
    ),
    pushDestination(root, branch),
    ignoredTouches(root, head),
  ]);
  // A change's stamp moves with anything its diff shows: HEAD, what's staged
  // (the index hash in its row) and the file on disk.
  const changes = opened.map(({ c }, i) => ({
    ...c,
    stamp: digest(JSON.stringify([head, stamps[i]])),
  }));
  const countsRead = counted(root, digest(JSON.stringify([head, stamps])), () =>
    lineCounts(root, changes, head),
  );
  const [counts, log, { lines, partial }] = await Promise.all([
    outgoingCounts(root, head, upstream, status.ab, unbornBehind, destination),
    outgoing(root, head, upstream, status.ab, destination),
    countsRead,
  ]);
  // Untracked files left for the next refresh to count.
  if (partial) counted.forget(root, countsRead);
  return {
    head,
    branch,
    changes,
    upstream,
    ahead: counts.ahead,
    behind: counts.behind,
    operation,
    lines,
    pushTarget: destination?.label ?? null,
    pushUrl: destination ? redactCredentials(destination.url) : null,
    ...(destination?.tracks && upstream && upstream !== destination.label
      ? { pushRetracks: true }
      : {}),
    outgoing: log
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((r) => ({
        sha: r.slice(0, r.indexOf(" ")),
        subject: r.slice(r.indexOf(" ") + 1),
      })),
    ...(ignored.touches.length ? { ignored: ignored.touches } : {}),
    // Ahead and behind stay out: a fetch in the background mustn't make a
    // Git action the user started read as made on a stale view.
    revision: digest(
      JSON.stringify([
        head,
        branch,
        stamps,
        upstream,
        destination,
        ignored.stamp,
      ]),
    ),
  };
}

type Destination = Awaited<ReturnType<typeof pushDestination>>;

/**
 * Commits ahead of and behind the upstream. A branch never pushed has none;
 * what it would push is everything its push remote has on no branch yet.
 */
async function outgoingCounts(
  root: string,
  head: string,
  upstream: string | null,
  ab: { ahead: number; behind: number } | null,
  unbornBehind: number | null,
  destination: Destination,
) {
  if (upstream) return ab ?? { ahead: 0, behind: unbornBehind ?? 0 };
  if (!destination || !head) return { ahead: 0, behind: 0 };
  const key = [
    head,
    destination.remote,
    await remoteRefsStamp(root, destination.remote, destination.ref),
  ].join("\0");
  const ahead = await unpushed(root, key, () =>
    git(root, [
      "rev-list",
      "--count",
      "HEAD",
      "--not",
      `--remotes=${destination.remote}`,
    ]).then((out) => Number(out.trim())),
  );
  return { ahead, behind: 0 };
}

/** The newest 30 commits a push would send, as `sha subject` lines. */
async function outgoing(
  root: string,
  head: string,
  upstream: string | null,
  ab: { ahead: number; behind: number } | null,
  destination: Destination,
) {
  if (!head) return "";
  if (upstream) {
    if (!ab?.ahead) return "";
    return outgoingLog(
      root,
      [head, upstream, ab.ahead, ab.behind].join("\0"),
      () => git(root, ["log", "-30", "--format=%H %s", `${upstream}..HEAD`]),
    );
  }
  if (!destination) return "";
  const key = [
    head,
    destination.remote,
    await remoteRefsStamp(root, destination.remote, destination.ref),
  ].join("\0");
  return outgoingLog(root, key, () =>
    git(root, [
      "log",
      "-30",
      "--format=%H %s",
      "HEAD",
      "--not",
      `--remotes=${destination.remote}`,
    ]),
  );
}

/** Refuses a commit made outside a branch, mid-operation or over conflicts. */
export function assertCommittable(state: WorkingTree) {
  if (!state.branch || state.operation)
    throw new Error(
      "Finish the current Git operation on a branch before committing here.",
    );
  if (state.changes.some((c) => c.conflict))
    throw new Error("Resolve and stage all merge conflicts first.");
}

const queue = keyedQueue();

export async function flushGitOperations() {
  await Promise.allSettled(queue.pending());
}

export const serializeRepo = <T>(root: string, run: () => Promise<T>) =>
  queue(root, run);
