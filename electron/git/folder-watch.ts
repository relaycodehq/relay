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

class EachFolder extends EventEmitter implements FolderWatch {
  private folders = new Map<string, FSWatcher>();
  private closed = false;

  constructor(
    private root: string,
    private options: EachFolderOptions,
    private listener: (file: string | null) => void,
  ) {
    super();
  }

  /** `strict`: the first crawl, which fails as a whole past the budget. */
  async add(start: string, strict = false) {
    const queue = [start];
    while (queue.length) {
      const at = queue.shift()!;
      if (this.closed || this.folders.has(at)) continue;
      if (this.folders.size >= this.options.budget) {
        if (strict) throw new Error(`more than ${this.options.budget} folders`);
        // Grown past it since: the rest waits for the slow poll.
        return;
      }
      const dir = join(this.root, at);
      // Watched before it's read, so a folder made meanwhile is still seen.
      const folder = watch(dir, (type, name) =>
        this.changed(at, type, name?.toString() ?? null),
      );
      folder.on("error", (error) =>
        at === "" ? this.emit("error", error) : this.drop(at),
      );
      this.folders.set(at, folder);
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (at === "") throw error;
        this.drop(at);
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const rel = at ? `${at}/${entry.name}` : entry.name;
        if (!this.options.skip(rel)) queue.push(rel);
      }
    }
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
    if (this.folders.has(rel)) return;
    if (await this.options.skipLater?.(rel).catch(() => false)) return;
    await this.add(rel).catch(() => {});
  }

  private drop(rel: string) {
    for (const [at, folder] of this.folders)
      if (at === rel || at.startsWith(`${rel}/`)) {
        folder.close();
        this.folders.delete(at);
      }
  }

  close() {
    this.closed = true;
    for (const folder of this.folders.values()) folder.close();
    this.folders.clear();
  }
}

/** How many folders one tree may watch: a share of what the user may hold. */
export async function folderBudget() {
  const most = await readFile("/proc/sys/fs/inotify/max_user_watches", "utf8")
    .then((text) => Number.parseInt(text, 10))
    .catch(() => NaN);
  // Older kernels default to 8192 for every program the user runs.
  return Math.min(20_000, Math.floor((most > 0 ? most : 8192) / 4));
}
