import { existsSync, watch as watchFolder } from "node:fs";
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { within } from "../util/paths";
import {
  folderBudget,
  watchEachFolder,
  type FolderWatch,
} from "./folder-watch";
import { git } from "./git";

/** A change waits this long for the ones that come with it, so a save or a commit refreshes once. */
const SETTLE_MS = 400;
/** Refreshes come no closer than this, however fast an agent writes: each runs Git a few times. */
const GAP_MS = 2000;
/**
 * A folder that broke (deleted, recreated, out of handles) is watched again
 * this much later, twice as long after each try that fails: one out of
 * inotify watches would otherwise take them from other programs every time.
 */
const RETRY_MS = 15_000;
const RETRY_MAX_MS = 4 * 60_000;

/**
 * Folders of a Git folder that churn on every command. "relay" holds Relay's
 * own notes, written as it reads the tree; Git's file system monitor drops a
 * cookie there on every `git status`.
 */
const CHURN = ["objects", "logs", "lfs", "hooks", "relay", "fsmonitor--daemon"];

/**
 * What a Git folder holds at its top, Relay's notes included. Tells where a
 * submodule's name ends under modules/ when its folder can't be asked.
 */
const GIT_ENTRIES = new Set([
  ...CHURN,
  "HEAD",
  "ORIG_HEAD",
  "FETCH_HEAD",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "COMMIT_EDITMSG",
  "index",
  "config",
  "description",
  "packed-refs",
  "shallow",
  "refs",
  "info",
  "modules",
  "worktrees",
  "sequencer",
  "rebase-merge",
  "rebase-apply",
]);

/**
 * Whether a change at `file` (relative to the watched folder) can show in
 * the working tree. Git's objects, logs and lock files churn on every
 * command; the refs, HEAD and index they end in are what count.
 * `isGitDir` says whether a folder (relative too) is a Git folder.
 */
export function noticed(
  file: string | null,
  inGitDir: boolean,
  isGitDir?: (rel: string) => boolean,
) {
  if (!file) return true;
  const parts = file.split(/[\\/]/);
  if (parts.includes("node_modules")) return false;
  const gitAt = inGitDir ? 0 : parts[0] === ".git" ? 1 : -1;
  if (gitAt < 0) return true;
  if (!pastChurn(parts, gitAt, isGitDir)) return false;
  const name = parts[parts.length - 1]!;
  return !name.endsWith(".lock") && name !== "FETCH_HEAD";
}

/** Whether `parts` from `at`, inside a Git folder, is outside its churn. */
function pastChurn(
  parts: string[],
  at: number,
  isGitDir?: (rel: string) => boolean,
): boolean {
  const entry = parts[at] ?? "";
  if (CHURN.includes(entry)) return false;
  if (entry === "worktrees" && parts[at + 2] === "logs") return false;
  if (entry !== "modules") return true;
  // A submodule's own Git folder sits at modules/<its name>/, with its own
  // submodules under it in turn. Branch names under refs/ may be anything.
  const inside = moduleEnd(parts, at + 1, isGitDir);
  return inside >= parts.length || pastChurn(parts, inside, isGitDir);
}

/**
 * Where the name of the submodule whose folder starts at `parts[start]`
 * ends. The name may have slashes and Git's own words in it (src/hooks), but
 * Git won't put one submodule's folder inside another's, so the first folder
 * on the way that is a Git folder is it. One not made yet ends at the first
 * of Git's entries past the name's first part.
 */
function moduleEnd(
  parts: string[],
  start: number,
  isGitDir?: (rel: string) => boolean,
) {
  if (isGitDir)
    for (let end = start + 1; end <= parts.length; end++)
      if (isGitDir(parts.slice(0, end).join("/"))) return end;
  for (let end = start + 1; end < parts.length; end++)
    if (GIT_ENTRIES.has(parts[end]!)) return end;
  return parts.length;
}

/**
 * Whether one recursive watch covers a whole tree here: macOS and Windows.
 * Windows was left out at first for fear a watched worktree couldn't be
 * removed; on Windows 11 `git worktree remove` works with both its folders
 * watched. Linux watches each folder on its own (see folder-watch.ts).
 */
export const watchesWholeTrees = (
  platform: NodeJS.Platform = process.platform,
) => platform === "darwin" || platform === "win32";

/** A native recursive watch, or Linux's budgeted folder-at-a-time backend. */
export const supportsTreeWatch = (
  platform: NodeJS.Platform = process.platform,
) => watchesWholeTrees(platform) || platform === "linux";

const inside = (dir: string, path: string) => within(dir, path) !== null;

interface Watch {
  owners: Set<object>;
  folders: FolderWatch[];
  timer?: ReturnType<typeof setTimeout>;
  retry?: ReturnType<typeof setTimeout>;
  /** When it last said `where` changed. */
  last: number;
  closed: boolean;
  /** Counts its opens; one a break or a later open overtook stops. */
  attempt: number;
  /** Tries in a row that failed since it last watched. */
  failed: number;
  /** Whether it's watching; false where it couldn't, and its owners poll. */
  ready: Promise<boolean>;
}

export interface TreeWatchDeps {
  /** The folder a workspace id names. */
  root(where: string): Promise<string>;
  /** Something in `where` changed that its working tree may show. */
  changed(where: string): void;
  /**
   * macOS and Windows watch a whole tree in one go; Linux watches each folder
   * Git can show (see folder-watch.ts).
   */
  platform?: NodeJS.Platform;
  watch?: typeof watchFolder;
  /** Git's own folder and the one its worktrees share. */
  gitDirs?(root: string): Promise<string[]>;
  isFolder?(path: string): Promise<boolean>;
  /** How long a change settles and the least time between two; tests go faster. */
  pace?: { settleMs: number; gapMs: number };
}

/**
 * Tells windows when the working tree they show may have changed, in place
 * of each running Git every few seconds to find out. Each window watches the
 * one place it shows; a place's folders are watched while any window shows it.
 */
export class TreeWatch {
  private shown = new Map<object, string>();
  private watches = new Map<string, Watch>();

  constructor(private deps: TreeWatchDeps) {}

  /** `owner` now shows `where`, or nothing. False when it should poll instead. */
  async show(owner: object, where: string | null): Promise<boolean> {
    const platform = this.deps.platform ?? process.platform;
    if (!supportsTreeWatch(platform)) return false;
    const was = this.shown.get(owner);
    if (was !== where) {
      if (was !== undefined) this.leave(owner, was);
      if (where === null) return false;
      this.shown.set(owner, where);
      this.watchFor(where).owners.add(owner);
    }
    if (where === null) return false;
    return this.watches.get(where)?.ready ?? false;
  }

  /** `owner`'s page went: what it showed needs no watching for it. */
  release(owner: object) {
    const was = this.shown.get(owner);
    if (was !== undefined) this.leave(owner, was);
  }

  dispose() {
    for (const owner of [...this.shown.keys()]) this.release(owner);
  }

  private watchFor(where: string) {
    let w = this.watches.get(where);
    if (w) return w;
    const watch: Watch = {
      owners: new Set(),
      folders: [],
      last: 0,
      closed: false,
      attempt: 0,
      failed: 0,
      ready: Promise.resolve(false),
    };
    watch.ready = this.open(where, watch);
    this.watches.set(where, watch);
    return watch;
  }

  /** `again`: a broken watch tried again, which keeps trying while it's shown. */
  private async open(where: string, w: Watch, again = false) {
    const attempt = ++w.attempt;
    const overtaken = () => w.closed || w.attempt !== attempt;
    try {
      const root = await this.deps.root(where);
      // A worktree's HEAD and index, and every checkout's refs, can live
      // outside its folder.
      const gitDirs = (await (this.deps.gitDirs ?? gitDirsOf)(root)).filter(
        (dir, i, all) =>
          !inside(root, dir) &&
          !all.some(
            (d, j) => j !== i && inside(d, dir) && (d !== dir || j < i),
          ),
      );
      if (overtaken()) return false;
      const eachFolder =
        (this.deps.platform ?? process.platform) === "linux"
          ? await this.eachFolder(root)
          : undefined;
      if (overtaken()) return false;
      const watch = this.deps.watch ?? watchFolder;
      const isFolder =
        this.deps.isFolder ??
        ((path: string) => lstat(path).then((s) => s.isDirectory()));
      for (const [dir, inGitDir] of [
        [root, false] as const,
        ...gitDirs.map((d) => [d, true] as const),
      ]) {
        const gitDir = gitDirAt(dir);
        const listener = (file: string | null, type?: string) => {
          if (!noticed(file, inGitDir, gitDir)) return;
          // Windows marks a folder changed when an entry in it comes or goes,
          // as a fetch's lock beside refs/remotes/origin/HEAD does with
          // nothing fetched. In Git's folder the entry's own event says
          // whether it counts.
          if (
            type === "change" &&
            file &&
            (inGitDir || /^\.git[\\/]/.test(file))
          )
            void isFolder(join(dir, file)).then(
              (folder) => folder || this.soon(where, w),
              () => this.soon(where, w),
            );
          else this.soon(where, w);
        };
        const folder = eachFolder
          ? await eachFolder(dir, inGitDir, listener)
          : watch(dir, { recursive: true }, (type, file) =>
              listener(file?.toString() ?? null, type),
            );
        // A folder broke meanwhile and closed what this opened; its retry
        // opens them all again.
        if (overtaken()) {
          folder.close();
          return false;
        }
        // Its folder went or can't be read: the next refresh says what's
        // wrong, and the folder is watched again once it's back.
        folder.on("error", () => {
          if (w.attempt === attempt) this.broke(where, w);
        });
        w.folders.push(folder);
      }
      w.failed = 0;
      // What changed while it wasn't watched.
      if (again) this.soon(where, w);
      return true;
    } catch {
      // What it opened went with whatever overtook it.
      if (overtaken()) return false;
      // Whatever opened before it failed; the next try opens its own.
      for (const folder of w.folders) folder.close();
      w.folders = [];
      if (again && !w.closed) this.retryLater(where, w);
      // Stays listed, so its owners keep polling until they show another place.
      else this.stop(w);
      return false;
    }
  }

  /**
   * Opens one folder of `root`'s place a folder at a time, leaving out what
   * Git ignores as well as its own churn.
   */
  private async eachFolder(root: string) {
    const [{ budget, shared }, ignored] = await Promise.all([
      folderBudget(),
      git(root, [
        "ls-files",
        "-o",
        "-i",
        "--exclude-standard",
        "--directory",
        "-z",
      ])
        .then(
          (out) => new Set(out.split("\0").map((p) => p.replace(/\/$/, ""))),
        )
        .catch(() => new Set<string>()),
    ]);
    const ignoredLater = askedTogether(root);
    return (
      dir: string,
      inGitDir: boolean,
      listener: (file: string | null) => void,
    ) => {
      const gitDir = gitDirAt(dir);
      return watchEachFolder(
        dir,
        {
          budget,
          shared,
          skip: (rel) =>
            !noticed(rel, inGitDir, gitDir) || (!inGitDir && ignored.has(rel)),
          skipLater: inGitDir ? undefined : ignoredLater,
        },
        listener,
      );
    };
  }

  private broke(where: string, w: Watch) {
    if (w.closed || w.retry) return;
    w.attempt++;
    for (const folder of w.folders) folder.close();
    w.folders = [];
    // Its owners poll until the retry watches again; the change below sends
    // them to ask, and so does the one the retry makes.
    w.ready = Promise.resolve(false);
    this.soon(where, w);
    this.retryLater(where, w);
  }

  private retryLater(where: string, w: Watch) {
    const wait = Math.min(RETRY_MS * 2 ** w.failed, RETRY_MAX_MS);
    w.failed++;
    w.retry = setTimeout(() => {
      w.retry = undefined;
      if (!w.closed) w.ready = this.open(where, w, true);
    }, wait);
  }

  private soon(where: string, w: Watch) {
    if (w.closed || w.timer) return;
    const { settleMs, gapMs } = this.deps.pace ?? {
      settleMs: SETTLE_MS,
      gapMs: GAP_MS,
    };
    const wait = Math.max(settleMs, w.last + gapMs - Date.now());
    w.timer = setTimeout(() => {
      w.timer = undefined;
      w.last = Date.now();
      if (!w.closed) this.deps.changed(where);
    }, wait);
  }

  private leave(owner: object, where: string) {
    this.shown.delete(owner);
    const w = this.watches.get(where);
    if (!w) return;
    w.owners.delete(owner);
    if (!w.owners.size) this.close(where, w);
  }

  private close(where: string, w: Watch) {
    this.stop(w);
    if (this.watches.get(where) === w) this.watches.delete(where);
  }

  private stop(w: Watch) {
    w.closed = true;
    clearTimeout(w.timer);
    clearTimeout(w.retry);
    for (const folder of w.folders) folder.close();
  }
}

/** Most folders one `git check-ignore` is asked about. */
const ASK_AT_ONCE = 200;

/**
 * Whether Git ignores a folder that appeared, asked of one Git at a time for
 * all that appeared meanwhile: a checkout or an unpacked archive makes
 * hundreds at once.
 */
export function askedTogether(root: string) {
  let waiting: { rel: string; answer(ignored: boolean): void }[] = [];
  let asking = false;
  const ask = async () => {
    while (waiting.length) {
      const batch = waiting.slice(0, ASK_AT_ONCE);
      waiting = waiting.slice(ASK_AT_ONCE);
      const rels = batch.map((b) => b.rel);
      // check-ignore rejects literal pathspec magic outright, and -z without
      // --stdin. It exits 1 when it ignores none, and fails the lot on one it
      // can't judge; those, and names it quotes, are watched.
      const ignored = await git(
        root,
        ["-c", "core.quotePath=false", "check-ignore", "--", ...rels],
        { env: { GIT_LITERAL_PATHSPECS: undefined } },
      ).then(
        (out) => new Set(out.split("\n")),
        () => new Set<string>(),
      );
      for (const { rel, answer } of batch) answer(ignored.has(rel));
    }
    asking = false;
  };
  return (rel: string) =>
    new Promise<boolean>((answer) => {
      waiting.push({ rel, answer });
      // A tick lets the rest of a burst join this one.
      if (!asking) {
        asking = true;
        setImmediate(() => void ask());
      }
    });
}

/** Whether a folder under `dir` (relative, "/"-separated) is a Git folder. */
const gitDirAt = (dir: string) => (rel: string) =>
  existsSync(join(dir, rel, "HEAD"));

async function gitDirsOf(root: string) {
  const out = await git(root, [
    "rev-parse",
    "--absolute-git-dir",
    "--git-common-dir",
  ]);
  return out
    .trim()
    .split("\n")
    .map((dir) => resolve(root, dir));
}
