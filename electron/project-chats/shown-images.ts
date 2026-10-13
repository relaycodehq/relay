// Copies of the local images answers show, so an image an agent left in a
// temp folder, or drew over with its next screenshot, still shows what the
// answer showed: <chats>/images/<chatId>/shown/<messageId>/<hash>.<ext>.
// Threads are archived, never deleted, so the copies are held to a total
// size, oldest dropped first; an answer whose copy is gone reads the file
// where the agent left it, if it's still there.
import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  rm,
  rmdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { extname, join } from "node:path";

/** A bigger image is read from where it is, not copied. */
const IMAGE_MAX_BYTES = 30_000_000;
/** All answers' copies together; past it the oldest go. */
export const SHOWN_IMAGES_MAX_BYTES = 500_000_000;
const PRUNE_EVERY_MS = 60 * 60_000;
const ID = /^[\w-]{1,80}$/;
/** Copies are named by a hash of their path, so this can't clash with one. */
const PREVIEW_SHOT = "preview.jpg";

export class ShownImages {
  private pruned = 0;
  private pruning: Promise<void> | undefined;

  constructor(
    private dir: string,
    private maxBytes = SHOWN_IMAGES_MAX_BYTES,
  ) {}

  /** Where answer `messageId` keeps its copy of the image at `path`. */
  path(chatId: string, messageId: string, path: string) {
    const name = createHash("sha256").update(path).digest("hex").slice(0, 32);
    return join(
      this.folder(chatId, messageId),
      name + extname(path).toLowerCase(),
    );
  }

  /** Copies the image at `path` as it is now. */
  async keep(chatId: string, messageId: string, path: string) {
    const { size } = await stat(path);
    if (size > IMAGE_MAX_BYTES) return;
    await mkdir(this.folder(chatId, messageId), {
      recursive: true,
      mode: 0o700,
    });
    const copy = this.path(chatId, messageId, path);
    await copyFile(path, copy);
    // The copy's age is when it was kept, whatever the file says.
    const now = new Date();
    await utimes(copy, now, now);
    if (Date.now() - this.pruned >= PRUNE_EVERY_MS) void this.prune();
  }

  /** Where answer `messageId` keeps the preview's last frame; see shared/preview's TurnPreview. */
  previewShot(chatId: string, messageId: string) {
    return join(this.folder(chatId, messageId), PREVIEW_SHOT);
  }

  /** Keeps the preview's last frame, over an earlier one of the same answer. */
  async keepPreviewShot(chatId: string, messageId: string, jpeg: Buffer) {
    await mkdir(this.folder(chatId, messageId), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(this.previewShot(chatId, messageId), jpeg, { mode: 0o600 });
    if (Date.now() - this.pruned >= PRUNE_EVERY_MS) void this.prune();
  }

  /** A fork's copies for the answers it carries over, under their new ids. */
  async copy(from: string, to: string, ids: Map<string, string>) {
    for (const [before, after] of ids)
      await cp(this.folder(from, before), this.folder(to, after), {
        recursive: true,
      }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      });
  }

  /** Drops the oldest copies until all of them fit in the cap. */
  prune(): Promise<void> {
    this.pruned = Date.now();
    // One at a time; a later call counts what earlier ones left.
    this.pruning = (this.pruning ?? Promise.resolve())
      .then(() => this.dropOldest())
      .catch((e) => console.warn("Could not trim the kept answer images:", e));
    return this.pruning;
  }

  private async dropOldest() {
    const files = await this.files();
    let total = files.reduce((sum, file) => sum + file.size, 0);
    if (total <= this.maxBytes) return;
    files.sort((a, b) => a.at - b.at);
    for (const file of files) {
      if (total <= this.maxBytes) break;
      await rm(file.path, { force: true });
      total -= file.size;
      // Only an emptied answer folder goes.
      await rmdir(file.folder).catch(() => {});
    }
  }

  private async files() {
    const found: { path: string; folder: string; size: number; at: number }[] =
      [];
    for (const chat of await names(this.dir)) {
      const shown = join(this.dir, chat, "shown");
      for (const message of await names(shown)) {
        const folder = join(shown, message);
        for (const name of await names(folder)) {
          const path = join(folder, name);
          const info = await stat(path).catch(() => null);
          if (info?.isFile())
            found.push({ path, folder, size: info.size, at: info.mtimeMs });
        }
      }
    }
    return found;
  }

  private folder(chatId: string, messageId: string) {
    if (!ID.test(chatId) || !ID.test(messageId))
      throw new Error("Invalid kept image identity.");
    return join(this.dir, chatId, "shown", messageId);
  }
}

const names = (dir: string) =>
  readdir(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return [];
    throw e;
  });
