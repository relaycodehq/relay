import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** What a tree watch hands back: closed when nobody shows the place. */
export interface FolderWatch {
  close(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface EachFolderOptions {
  /** Folders (relative, "/"-separated) not to watch, nor anything under them. */
  skip(rel: string): boolean;
  /** Asked of a folder that appears later, which `skip` didn't know of. */
  skipLater?(rel: string): Promise<boolean>;
  /** Most folders to watch; more than this at the start and it throws. */
  budget: number;
  /** Watches every tree takes from, which can run out before `budget` does. */
  shared?: WatchPool;
}

/**
 * The inotify watches Relay's trees share: each tree's own budget alone would
 * let a few big places together take what the user's other programs need.
 */
export class WatchPool {
  private used = 0;
  constructor(readonly size: number) {}
  take() {
    if (this.used >= this.size) return false;
    this.used++;
    return true;
  }
  give(count = 1) {
    this.used = Math.max(0, this.used - count);
  }
}

/**
 * Linux's inotify watches a folder, not what's under it, so Node's recursive
 * watch there walks the whole tree, node_modules and build output included,
 * and runs out of watches on a big checkout. This watches each folder that
 * can show in the working tree on its own, as VS Code does, and follows the
 * folders that come and go.
 */
export async function watchEachFolder(
  root: string,
  options: EachFolderOptions,
  listener: (file: string | null) => void,
): Promise<FolderWatch> {
  const folders = new EachFolder(root, options, listener);
  try {
    await folders.add("", true);
  } catch (error) {
    folders.close();
    throw error;
  }
  return folders;
}

/**
 * Errors that say a folder isn't there to watch or read: gone since its
 * parent was read, or not the user's to read. Any other (out of inotify
 * watches, out of handles) leaves holes, so the watch fails and its owner
 * polls instead.
 */
const unreachable = (error: unknown) =>
  ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(
    (error as NodeJS.ErrnoException | null)?.code ?? "",
  );

const parentOf = (rel: string) =>
  rel.slice(0, Math.max(rel.lastIndexOf("/"), 0));

class EachFolder extends EventEmitter implements FolderWatch {
  private folders = new Map<string, FSWatcher>();
  /** Watched folders by their parent, so a folder drops with what's under it without a scan. */
  private under = new Map<string, Set<string>>();
  private closed = false;
  /** It broke before anyone listened: fails the first crawl. */
  private failed?: Error;
  private full = false;

  constructor(
    private root: string,
    private options: EachFolderOptions,
    private listener: (file: string | null) => void,
  ) {
    super();
  }

  /**
   * `strict`: the first crawl, which fails as a whole past the budget.
   * Later, what's under `start` is asked about with `skipLater` as well.
   */
  async add(start: string, strict = false) {
    let level = [start];
    while (level.length) {
      const next: string[] = [];
      for (const at of level) {
        if (this.closed || this.folders.has(at)) continue;
        // Its parent went while this waited, and took it along.
        if (at !== start && !this.folders.has(parentOf(at))) continue;
        const over = this.folders.size >= this.options.budget;
        if (over || !(this.options.shared?.take() ?? true)) {
          const why = over
            ? `more than ${this.options.budget} folders`
            : `no folder watches left of Relay's ${this.options.shared!.size}`;
          if (strict) throw new Error(why);
          // Grown past it since: the rest waits for the slow poll.
          if (!this.full)
            console.warn(
              `[tree-watch] ${this.root} has ${why}; new ones aren't watched`,
            );
          this.full = true;
          return;
        }
        const dir = join(this.root, at);
        let folder;
        try {
          // Watched before it's read, so a folder made meanwhile is still seen.
          folder = watch(dir, (type, name) =>
            this.changed(at, type, name?.toString() ?? null),
          );
        } catch (error) {
          this.options.shared?.give();
          if (at === "" || !unreachable(error)) throw error;
          continue;
        }
        folder.on("error", (error) => {
          if (at !== "" && unreachable(error)) this.drop(at);
          else this.fail(error);
        });
        this.watched(at, folder);
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
          if (at === "" || !unreachable(error)) throw error;
          this.drop(at);
          continue;
        }
        if (strict && this.failed) throw this.failed;
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const rel = at ? `${at}/${entry.name}` : entry.name;
          if (!this.options.skip(rel)) next.push(rel);
        }
      }
      level = strict ? next : await this.notIgnored(next);
    }
    if (strict && this.failed) throw this.failed;
  }

  /** Those of `rels` Git doesn't ignore, asked all at once. */
  private async notIgnored(rels: string[]) {
    const skipLater = this.options.skipLater;
    if (!skipLater || !rels.length) return rels;
    const ignored = await Promise.all(
      rels.map((rel) => skipLater(rel).catch(() => false)),
    );
    return rels.filter((_, i) => !ignored[i]);
  }

  private changed(at: string, type: string, name: string | null) {
    if (this.closed) return;
    if (name === null) return this.listener(null);
    const rel = at ? `${at}/${name}` : name;
    this.listener(rel);
    if (type !== "rename" || this.options.skip(rel)) return;
    void this.appeared(rel);
  }

  /** `rel` was made, moved or deleted. */
  private async appeared(rel: string) {
    try {
      if (!(await stat(join(this.root, rel))).isDirectory()) return;
    } catch {
      return this.drop(rel);
    }
    // Deleted and made again, or another moved over it: the old watch sees
    // the folder that went.
    this.drop(rel);
    if (await this.options.skipLater?.(rel).catch(() => false)) return;
    await this.add(rel).catch((error: Error) => this.fail(error));
  }

  private fail(error: Error) {
    if (this.closed) return;
    if (this.listenerCount("error")) this.emit("error", error);
    else this.failed ??= error;
  }

  private watched(at: string, folder: FSWatcher) {
    this.folders.set(at, folder);
    if (at === "") return;
    const parent = parentOf(at);
    const siblings = this.under.get(parent);
    if (siblings) siblings.add(at);
    else this.under.set(parent, new Set([at]));
  }

  private drop(rel: string) {
    const below = this.under.get(rel);
    if (below) {
      this.under.delete(rel);
      for (const at of below) this.drop(at);
    }
    const folder = this.folders.get(rel);
    if (!folder) return;
    folder.close();
    this.folders.delete(rel);
    this.options.shared?.give();
    const parent = parentOf(rel);
    const siblings = this.under.get(parent);
    siblings?.delete(rel);
    if (siblings?.size === 0) this.under.delete(parent);
  }

  close() {
    this.closed = true;
    for (const folder of this.folders.values()) folder.close();
    this.options.shared?.give(this.folders.size);
    this.folders.clear();
    this.under.clear();
  }
}

async function watchPool() {
  const most = await readFile("/proc/sys/fs/inotify/max_user_watches", "utf8")
    .then((text) => Number.parseInt(text, 10))
    .catch(() => NaN);
  // Older kernels default to 8192 for every program the user runs.
  return new WatchPool(Math.floor((most > 0 ? most : 8192) / 4));
}
let pool: Promise<WatchPool> | undefined;

/**
 * How many folders one tree may watch, and the watches all of them share: a
 * quarter of what the user may hold.
 */
export async function folderBudget() {
  const shared = await (pool ??= watchPool());
  return { budget: Math.min(20_000, shared.size), shared };
}
