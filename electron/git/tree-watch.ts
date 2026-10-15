import { watch as watchFolder, type FSWatcher } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { git } from "./git";

/** A change waits this long for the ones that come with it, so a save or a commit refreshes once. */
const SETTLE_MS = 400;
/** Refreshes come no closer than this, however fast an agent writes: each runs Git a few times. */
const GAP_MS = 2000;
/** A folder that broke (deleted, recreated, out of handles) is watched again this much later. */
const RETRY_MS = 15_000;

/**
 * Whether a change at `file` (relative to the watched folder) can show in
 * the working tree. Git's objects, logs and lock files churn on every
 * command; the refs, HEAD and index they end in are what count.
 */
export function noticed(file: string | null, inGitDir: boolean) {
  if (!file) return true;
  const parts = file.split(/[\\/]/);
  if (parts.includes("node_modules")) return false;
  const gitAt = inGitDir ? 0 : parts[0] === ".git" ? 1 : -1;
  if (gitAt < 0) return true;
  const inside = parts.slice(gitAt);
  // "relay" holds Relay's own notes, written as it reads the tree; Git's
  // file system monitor drops a cookie there on every `git status`.
  if (
    ["objects", "logs", "lfs", "hooks", "relay", "fsmonitor--daemon"].includes(
      inside[0] ?? "",
    )
  )
    return false;
  const name = parts[parts.length - 1]!;
  return !name.endsWith(".lock") && name !== "FETCH_HEAD";
}

const within = (dir: string, path: string) => {
  const rel = relative(dir, path);
  return !rel.startsWith("..") && !isAbsolute(rel);
};

interface Watch {
  owners: Set<object>;
  folders: FSWatcher[];
  timer?: ReturnType<typeof setTimeout>;
  retry?: ReturnType<typeof setTimeout>;
  /** When it last said `where` changed. */
  last: number;
  closed: boolean;
  /** Whether it's watching; false where it couldn't, and its owners poll. */
  ready: Promise<boolean>;
}

export interface TreeWatchDeps {
  /** The folder a workspace id names. */
  root(where: string): Promise<string>;
  /** Something in `where` changed that its working tree may show. */
  changed(where: string): void;
  /**
   * Only macOS watches: Linux needs an inotify watch per folder, which costs
   * more than the poll it saves, and Windows holds the folder open, which can
   * keep a worktree from being removed. Neither has been tried.
   */
  platform?: NodeJS.Platform;
  watch?: typeof watchFolder;
  /** Git's own folder and the one its worktrees share. */
  gitDirs?(root: string): Promise<string[]>;
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
    if ((this.deps.platform ?? process.platform) !== "darwin") return false;
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
      ready: Promise.resolve(false),
    };
    watch.ready = this.open(where, watch);
    this.watches.set(where, watch);
    return watch;
  }

  /** `again`: a broken watch tried again, which keeps trying while it's shown. */
  private async open(where: string, w: Watch, again = false) {
    try {
      const root = await this.deps.root(where);
      // A worktree's HEAD and index, and every checkout's refs, can live
      // outside its folder.
      const gitDirs = (await (this.deps.gitDirs ?? gitDirsOf)(root)).filter(
        (dir, i, all) =>
          !within(root, dir) &&
          !all.some((d, j) => j !== i && within(d, dir) && (d !== dir || j < i)),
      );
      if (w.closed) return false;
      const watch = this.deps.watch ?? watchFolder;
      for (const [dir, inGitDir] of [
        [root, false] as const,
        ...gitDirs.map((d) => [d, true] as const),
      ]) {
        const folder = watch(dir, { recursive: true }, (_type, file) => {
          if (noticed(file?.toString() ?? null, inGitDir)) this.soon(where, w);
        });
        // Its folder went or can't be read: the next refresh says what's
        // wrong, and the folder is watched again once it's back.
        folder.on("error", () => this.broke(where, w));
        w.folders.push(folder);
      }
      // What changed while it wasn't watched.
      if (again) this.soon(where, w);
      return true;
    } catch {
      if (again && !w.closed) this.retryLater(where, w);
      // Stays listed, so its owners keep polling until they show another place.
      else this.stop(w);
      return false;
    }
  }

  private broke(where: string, w: Watch) {
    if (w.closed || w.retry) return;
    for (const folder of w.folders) folder.close();
    w.folders = [];
    this.soon(where, w);
    this.retryLater(where, w);
  }

  private retryLater(where: string, w: Watch) {
    w.retry = setTimeout(() => {
      w.retry = undefined;
      if (!w.closed) w.ready = this.open(where, w, true);
    }, RETRY_MS);
  }

  private soon(where: string, w: Watch) {
    if (w.closed || w.timer) return;
    const wait = Math.max(SETTLE_MS, w.last + GAP_MS - Date.now());
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
