import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip as gunzipCallback, gzip as gzipCallback } from "node:zlib";
import { z } from "zod";
import {
  localHistoryReasonSchema,
  type LocalHistoryEntry,
  type LocalHistoryReason,
} from "../../shared/local-history";
import { writeFileAtomic } from "../util/atomic-write";
import { digest } from "../util/hash";
import { keyedQueue } from "../util/keyed-queue";

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

export interface HistoryLimits {
  /** A version over this many bytes is noted but not kept. */
  maxSnapshotBytes: number;
  maxAgeMs: number;
  maxEntriesPerFile: number;
  /** Compressed bytes of all kept text; the oldest versions go first. */
  maxTotalBytes: number;
  /** Wait this long after a write before pruning, or null to prune only on `sweep()`. */
  sweepDelayMs: number | null;
  /** Prune again after this long, at the next write. */
  sweepEveryMs: number;
  /** Prune sooner once this many bytes were written since the last time. */
  sweepAfterBytes: number;
}

export const defaultLimits: HistoryLimits = {
  maxSnapshotBytes: 5 * MB,
  maxAgeMs: 30 * DAY,
  maxEntriesPerFile: 100,
  maxTotalBytes: 500 * MB,
  sweepDelayMs: 30_000,
  sweepEveryMs: 6 * 60 * 60 * 1000,
  sweepAfterBytes: 50 * MB,
};

const entrySchema = z.object({
  id: z.string().min(1).max(100),
  time: z.number(),
  reason: localHistoryReasonSchema,
  label: z.string().max(200).optional(),
  size: z.number().int().min(0),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  skipped: z.boolean().optional(),
});
const indexSchema = z.object({
  version: z.literal(1),
  /** The file's real path, so a folder can be told from what it was made for. */
  path: z.string(),
  /** Oldest first. */
  entries: z.array(entrySchema),
});
type Index = z.infer<typeof indexSchema>;

/** A temporary file this old belongs to a write that died. */
const STALE_TEMP_MS = 10 * 60 * 1000;

export interface SweepResult {
  files: number;
  entries: number;
  /** Compressed bytes of the text still kept. */
  bytes: number;
  removedEntries: number;
  removedBlobs: number;
}

/**
 * Every version Local History keeps, on disk under `dir`:
 *
 *     files/<hash of the real path>/index.json   the file's entries, oldest first
 *     blobs/<ab>/<sha256 of the text>.gz         the text, shared by all files
 *
 * The blobs are content-addressed, so a text kept twice (or by two files) is
 * on disk once. Every write goes through one queue and lands by temp file and
 * rename; a crash leaves the old index or the new one. Pruning (age, count per
 * file, total size) runs from `sweep()`, which a write schedules for later
 * so a save never waits for it.
 */
export class LocalHistoryStore {
  private limits: HistoryLimits;
  private queue = keyedQueue();
  private lastSweep = 0;
  private written = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastTime = 0;
  /** Writes queued or running, per file. */
  private pendingWrites = new Map<string, number>();

  constructor(
    private dir: string,
    limits: Partial<HistoryLimits> = {},
  ) {
    this.limits = { ...defaultLimits, ...limits };
  }

  private folder(file: string) {
    return join(this.dir, "files", digest(file).slice(0, 32));
  }
  private blob(hash: string) {
    return join(this.dir, "blobs", hash.slice(0, 2), `${hash}.gz`);
  }
  /** Jobs run one at a time, so a sweep never deletes the text a write is about to point at. */
  private serial<T>(job: () => Promise<T>) {
    return this.queue("store", job);
  }

  /** The file's index; one that can't be read counts as empty, since its blobs are swept as unreferenced. */
  private async load(file: string): Promise<Index> {
    const empty: Index = { version: 1, path: file, entries: [] };
    try {
      const text = await readFile(
        join(this.folder(file), "index.json"),
        "utf8",
      );
      const parsed = indexSchema.safeParse(JSON.parse(text));
      return parsed.success && parsed.data.path === file ? parsed.data : empty;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("Local History could not read an index:", e);
      return empty;
    }
  }
  private save(index: Index) {
    return writeFileAtomic(
      join(this.folder(index.path), "index.json"),
      JSON.stringify(index),
      { mkdir: 0o700 },
    );
  }

  /** The versions of `file`, newest first. */
  list(file: string): Promise<LocalHistoryEntry[]> {
    return this.serial(async () => (await this.load(file)).entries.reverse());
  }

  /** Whether `file` has any version kept, or one is on its way. */
  async has(file: string): Promise<boolean> {
    // Not queued, so a save never waits on a sweep; a write still waiting its turn counts.
    return (
      this.pendingWrites.has(file) || (await this.load(file)).entries.length > 0
    );
  }

  async read(file: string, id: string): Promise<string> {
    const entry = (await this.list(file)).find((e) => e.id === id);
    if (!entry) throw new Error("That version is no longer in the history.");
    if (entry.skipped) throw new Error("That version was too large to keep.");
    try {
      return (await gunzip(await readFile(this.blob(entry.hash)))).toString(
        "utf8",
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("That version is no longer in the history.");
      throw e;
    }
  }

  /**
   * Keeps `contents` as the file's newest version. A save or an external
   * change that repeats the newest version's text keeps nothing and returns
   * null. Labels and "before revert" are marks the user asked for, so they
   * are kept every time.
   */
  record(
    file: string,
    contents: string,
    reason: LocalHistoryReason,
    label?: string,
  ): Promise<LocalHistoryEntry | null> {
    this.pendingWrites.set(file, (this.pendingWrites.get(file) ?? 0) + 1);
    return this.serial(() => this.write(file, contents, reason, label)).finally(() => {
      const left = (this.pendingWrites.get(file) ?? 1) - 1;
      if (left) this.pendingWrites.set(file, left);
      else this.pendingWrites.delete(file);
    });
  }

  private async write(
    file: string,
    contents: string,
    reason: LocalHistoryReason,
    label?: string,
  ): Promise<LocalHistoryEntry | null> {
    const index = await this.load(file);
    const size = Buffer.byteLength(contents);
    const hash = digest(contents);
    const repeatsNewest = index.entries.at(-1)?.hash === hash;
    const askedForByUser = reason === "label" || reason === "before-revert";
    if (repeatsNewest && !askedForByUser) return null;
    const skipped = size > this.limits.maxSnapshotBytes;
    if (!skipped) this.written += await this.putBlob(hash, contents);
    // Ids sort by creation, and a clock that stepped back doesn't reorder them.
    this.lastTime = Math.max(Date.now(), this.lastTime + 1);
    const entry: LocalHistoryEntry = {
      id: randomUUID(),
      time: this.lastTime,
      reason,
      ...(label ? { label } : {}),
      size,
      hash,
      ...(skipped ? { skipped } : {}),
    };
    index.entries.push(entry);
    this.trim(index, entry.time);
    await this.save(index);
    this.scheduleSweep();
    return entry;
  }

  /** Bytes written; 0 when the text was already there. */
  private async putBlob(hash: string, contents: string) {
    const path = this.blob(hash);
    if (
      await stat(path).then(
        () => true,
        () => false,
      )
    )
      return 0;
    const packed = await gzip(contents);
    await writeFileAtomic(path, packed, { mkdir: 0o700 });
    return packed.length;
  }

  /** Drops what is past the age and count limits; returns how many entries went. */
  private trim(index: Index, now: number) {
    const before = index.entries.length;
    index.entries = index.entries
      .filter((e) => now - e.time <= this.limits.maxAgeMs)
      .slice(-this.limits.maxEntriesPerFile);
    return before - index.entries.length;
  }

  private scheduleSweep() {
    const { sweepDelayMs, sweepEveryMs, sweepAfterBytes } = this.limits;
    if (sweepDelayMs === null || this.timer) return;
    const dueByTime = Date.now() - this.lastSweep >= sweepEveryMs;
    const dueByBytes = this.written >= sweepAfterBytes;
    if (!dueByTime && !dueByBytes) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.sweep().catch((e) => console.warn("Local History sweep failed:", e));
    }, sweepDelayMs);
    this.timer.unref?.();
  }

  /** Stops a sweep that is waiting to start. */
  close() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Applies every limit to everything kept: the age and count of each file,
   * then the total size, oldest version first. Deletes text no entry points
   * to and temporary files left by a write that died.
   */
  sweep(): Promise<SweepResult> {
    return this.serial(async () => {
      const now = Date.now();
      this.lastSweep = now;
      this.written = 0;
      const indexes = await this.loadAll();
      const changed = new Set<Index>();
      let removedEntries = 0;
      for (const index of indexes) {
        const removed = this.trim(index, now);
        if (removed === 0) continue;
        removedEntries += removed;
        changed.add(index);
      }
      const sizes = await this.blobSizes();
      const references = countReferences(indexes);
      const overTotal = this.dropOldestOverTotal(
        indexes,
        references,
        sizes,
        changed,
      );
      await this.saveChanged(changed);
      const removedBlobs = await this.removeUnreferencedBlobs(
        sizes,
        references,
      );
      await this.removeStaleTemps();
      return {
        files: indexes.filter((i) => i.entries.length).length,
        entries: indexes.reduce((n, i) => n + i.entries.length, 0),
        bytes: overTotal.bytes,
        removedEntries: removedEntries + overTotal.removedEntries,
        removedBlobs,
      };
    });
  }

  /**
   * Removes the oldest versions of all files until the kept text fits
   * `maxTotalBytes`. Updates `references` and adds the indexes it cut to
   * `changed`; returns the bytes still kept and the entries removed.
   */
  private dropOldestOverTotal(
    indexes: Index[],
    references: Map<string, number>,
    sizes: Map<string, number>,
    changed: Set<Index>,
  ) {
    let bytes = keptBytes(references, sizes);
    let removedEntries = 0;
    if (bytes <= this.limits.maxTotalBytes) return { bytes, removedEntries };
    const oldestFirst = indexes
      .flatMap((index) => index.entries.map((entry) => ({ index, entry })))
      .sort((a, b) => a.entry.time - b.entry.time);
    for (const { index, entry } of oldestFirst) {
      if (bytes <= this.limits.maxTotalBytes) break;
      index.entries.splice(index.entries.indexOf(entry), 1);
      changed.add(index);
      removedEntries++;
      if (entry.skipped) continue;
      const left = (references.get(entry.hash) ?? 0) - 1;
      references.set(entry.hash, left);
      if (left === 0) bytes -= sizes.get(entry.hash) ?? 0;
    }
    return { bytes, removedEntries };
  }

  /** Writes the cut indexes, or removes a file's folder once nothing is left of it. */
  private async saveChanged(changed: Set<Index>) {
    // Indexes first: a crash between the two leaves unreferenced text, never a dangling entry.
    for (const index of changed) {
      if (index.entries.length) await this.save(index);
      else await rm(this.folder(index.path), { recursive: true, force: true });
    }
  }

  private async removeUnreferencedBlobs(
    sizes: Map<string, number>,
    references: Map<string, number>,
  ) {
    let removed = 0;
    for (const hash of sizes.keys()) {
      if ((references.get(hash) ?? 0) > 0) continue;
      await rm(this.blob(hash), { force: true });
      removed++;
    }
    return removed;
  }

  private async loadAll(): Promise<Index[]> {
    const names = await readdir(join(this.dir, "files")).catch(() => []);
    const indexes: Index[] = [];
    for (const name of names) {
      const path = join(this.dir, "files", name, "index.json");
      const parsed = await readFile(path, "utf8")
        .then((text) => indexSchema.safeParse(JSON.parse(text)))
        .catch(() => null);
      const readable =
        parsed?.success && digest(parsed.data.path).slice(0, 32) === name;
      if (readable) indexes.push(parsed.data);
      else
        // An index nobody can read is no history; its text is swept as unreferenced.
        await rm(join(this.dir, "files", name), {
          recursive: true,
          force: true,
        });
    }
    return indexes;
  }

  /** Every blob on disk: hash to compressed size. */
  private async blobSizes() {
    const sizes = new Map<string, number>();
    for (const shard of await this.subfolders("blobs")) {
      for (const name of await readdir(shard).catch(() => [])) {
        if (!name.endsWith(".gz")) continue;
        const info = await stat(join(shard, name)).catch(() => null);
        if (info) sizes.set(name.replace(/\.gz$/, ""), info.size);
      }
    }
    return sizes;
  }

  /** The folders directly under `<dir>/<name>`. */
  private async subfolders(name: string) {
    const parent = join(this.dir, name);
    const children = await readdir(parent).catch(() => []);
    return children.map((child) => join(parent, child));
  }

  private async removeStaleTemps() {
    const cutoff = Date.now() - STALE_TEMP_MS;
    const folders = [
      ...(await this.subfolders("files")),
      ...(await this.subfolders("blobs")),
    ];
    for (const folder of folders)
      for (const name of await readdir(folder).catch(() => [])) {
        if (!name.endsWith(".tmp")) continue;
        const info = await stat(join(folder, name)).catch(() => null);
        if (info && info.mtimeMs < cutoff)
          await rm(join(folder, name), { force: true });
      }
  }
}

/** How many entries point at each text. */
function countReferences(indexes: Index[]) {
  const references = new Map<string, number>();
  for (const index of indexes)
    for (const entry of index.entries) {
      if (entry.skipped) continue;
      references.set(entry.hash, (references.get(entry.hash) ?? 0) + 1);
    }
  return references;
}

/** Compressed bytes of the texts that at least one entry still points at. */
function keptBytes(
  references: Map<string, number>,
  sizes: Map<string, number>,
) {
  let bytes = 0;
  for (const [hash, count] of references)
    if (count > 0) bytes += sizes.get(hash) ?? 0;
  return bytes;
}
