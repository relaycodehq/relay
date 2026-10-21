import { TreeWatch, supportsTreeWatch, type TreeWatchDeps } from "./tree-watch";

export interface ElsewhereWatchDeps extends Pick<
  TreeWatchDeps,
  "platform" | "watch" | "gitDirs"
> {
  /** Something changed in a repository `chatId`'s agents changed files in. */
  changed(chatId: string): void;
}

interface Shown {
  chatId: string;
  /** Each repository it watches, by the key TreeWatch knows it under. */
  roots: Map<string, object>;
}

/**
 * Tells windows when the other repositories a thread's agents changed files
 * in may have changed, as TreeWatch does for the folder a window shows, in
 * place of running Git in each every few seconds. Each window watches those
 * of the one thread whose Changes it shows.
 */
export class ElsewhereWatch {
  private shown = new Map<object, Shown>();
  private trees: TreeWatch;

  constructor(private deps: ElsewhereWatchDeps) {
    this.trees = new TreeWatch({
      platform: deps.platform,
      watch: deps.watch,
      gitDirs: deps.gitDirs,
      root: async (root) => root,
      changed: (root) => this.rootChanged(root),
    });
  }

  /** Whether this computer watches at all; elsewhere windows poll. */
  get watches() {
    return supportsTreeWatch(this.deps.platform);
  }

  /** `owner` now shows `chatId`'s changes, or none; `roots` then says where they are. */
  show(owner: object, chatId: string | null) {
    const was = this.shown.get(owner);
    if (was?.chatId === chatId) return;
    this.release(owner);
    if (chatId !== null && this.watches)
      this.shown.set(owner, { chatId, roots: new Map() });
  }

  /** Whether `owner` still shows `chatId`, as asked last. */
  showing(owner: object, chatId: string) {
    return this.shown.get(owner)?.chatId === chatId;
  }

  /**
   * The repositories other than its own that `chatId`'s agents changed files
   * in, now: the windows showing it watch these. True once all are watched.
   */
  async roots(chatId: string, roots: string[]): Promise<boolean> {
    if (!this.watches) return false;
    const ready: Promise<boolean>[] = [];
    for (const shown of this.shown.values()) {
      if (shown.chatId !== chatId) continue;
      for (const [root, key] of shown.roots)
        if (!roots.includes(root)) {
          shown.roots.delete(root);
          this.trees.release(key);
        }
      for (const root of roots) {
        let key = shown.roots.get(root);
        if (!key) shown.roots.set(root, (key = {}));
        ready.push(this.trees.show(key, root));
      }
    }
    return (await Promise.all(ready)).every(Boolean);
  }

  /** `owner`'s page went, or shows no thread's changes. */
  release(owner: object) {
    const shown = this.shown.get(owner);
    if (!shown) return;
    this.shown.delete(owner);
    for (const key of shown.roots.values()) this.trees.release(key);
  }

  dispose() {
    this.shown.clear();
    this.trees.dispose();
  }

  private rootChanged(root: string) {
    const chats = new Set<string>();
    for (const shown of this.shown.values())
      if (shown.roots.has(root)) chats.add(shown.chatId);
    for (const chatId of chats) this.deps.changed(chatId);
  }
}
