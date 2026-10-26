import {
  mkdtemp,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalHistoryStore, type HistoryLimits } from "./store";
import { writeFileAtomic as realWrite } from "../util/atomic-write";

const failing = vi.hoisted(() => ({ on: false }));
vi.mock("../util/atomic-write", async (original) => {
  const mod = await original<typeof import("../util/atomic-write")>();
  return {
    ...mod,
    writeFileAtomic: (path: string, ...rest: unknown[]) => {
      if (failing.on && path.endsWith("index.json"))
        return Promise.reject(new Error("disk full"));
      return (mod.writeFileAtomic as typeof realWrite)(
        path,
        ...(rest as [string]),
      );
    },
  };
});

let dir: string;
const stores: LocalHistoryStore[] = [];
/** A store that prunes only when a test says so. */
function open(limits: Partial<HistoryLimits> = {}) {
  const store = new LocalHistoryStore(dir, { sweepDelayMs: null, ...limits });
  stores.push(store);
  return store;
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-local-history-"));
  failing.on = false;
});
afterEach(async () => {
  vi.useRealTimers();
  for (const s of stores.splice(0)) s.close();
  await rm(dir, { recursive: true, force: true });
});

/** Every file under `dir`/`sub`, relative to `dir`. */
async function tree(sub = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(join(dir, sub), { withFileTypes: true }).catch(
    () => [],
  );
  for (const e of entries)
    if (e.isDirectory()) out.push(...(await tree(join(sub, e.name))));
    else out.push(join(sub, e.name));
  return out;
}
const blobs = async () =>
  (await tree("blobs")).filter((f) => f.endsWith(".gz"));

it("lists versions newest first and reads each back", async () => {
  const store = open();
  await store.record("/p/a.ts", "one", "save");
  await store.record("/p/a.ts", "two", "save");
  await store.record("/p/a.ts", "three", "external");
  const list = await store.list("/p/a.ts");
  expect(list.map((e) => e.reason)).toEqual(["external", "save", "save"]);
  expect(list.map((e) => e.size)).toEqual([5, 3, 3]);
  expect(
    await Promise.all(list.map((e) => store.read("/p/a.ts", e.id))),
  ).toEqual(["three", "two", "one"]);
  expect(await store.list("/p/other.ts")).toEqual([]);
});

it("keeps one blob for repeated text, in this file or another", async () => {
  const store = open();
  await store.record("/p/a.ts", "same", "save");
  await store.record("/p/b.ts", "same", "save");
  await store.record("/p/a.ts", "different", "save");
  await store.record("/p/a.ts", "same", "save");
  expect(await blobs()).toHaveLength(2);
  expect(await store.list("/p/a.ts")).toHaveLength(3);
});

it("does not repeat a save or external change, but keeps labels and marks every time", async () => {
  const store = open();
  expect(await store.record("/p/a.ts", "x", "save")).not.toBeNull();
  expect(await store.record("/p/a.ts", "x", "save")).toBeNull();
  expect(await store.record("/p/a.ts", "x", "external")).toBeNull();
  expect(
    await store.record("/p/a.ts", "x", "label", "Before refactor"),
  ).not.toBeNull();
  expect(await store.record("/p/a.ts", "x", "before-revert")).not.toBeNull();
  expect((await store.list("/p/a.ts")).map((e) => e.label)).toEqual([
    undefined,
    "Before refactor",
    undefined,
  ]);
});

it("notes a version over the size limit without keeping its text", async () => {
  const store = open({ maxSnapshotBytes: 10 });
  const entry = await store.record("/p/big.txt", "x".repeat(11), "save");
  expect(entry).toMatchObject({ skipped: true, size: 11 });
  expect(await blobs()).toEqual([]);
  await expect(store.read("/p/big.txt", entry!.id)).rejects.toThrow(
    "too large",
  );
  // Under the limit again, history carries on.
  await store.record("/p/big.txt", "small", "save");
  expect(await store.list("/p/big.txt")).toHaveLength(2);
});

it("leaves the history as it was when an index write fails, and recovers", async () => {
  const store = open();
  await store.record("/p/a.ts", "one", "save");
  failing.on = true;
  await expect(store.record("/p/a.ts", "two", "save")).rejects.toThrow(
    "disk full",
  );
  failing.on = false;
  expect((await store.list("/p/a.ts")).map((e) => e.size)).toEqual([3]);
  // The text written before the failed index is unreferenced, and the next sweep takes it.
  expect(await blobs()).toHaveLength(2);
  const swept = await store.sweep();
  expect(swept.removedBlobs).toBe(1);
  expect(await blobs()).toHaveLength(1);
  await store.record("/p/a.ts", "two", "save");
  expect(await store.list("/p/a.ts")).toHaveLength(2);
});

it("treats a corrupt index as no history instead of failing", async () => {
  const store = open();
  await store.record("/p/a.ts", "one", "save");
  const index = (await tree("files")).find((f) => f.endsWith("index.json"))!;
  await writeFile(join(dir, index), '{"version":1,"entries":[{"id":');
  // A new run of Relay finds it.
  const again = open();
  expect(await again.list("/p/a.ts")).toEqual([]);
  expect(await again.has("/p/a.ts")).toBe(false);
  expect(await again.record("/p/a.ts", "two", "save")).not.toBeNull();
  expect(await again.list("/p/a.ts")).toHaveLength(1);
});

it("sweeps away a corrupt index and the text only it pointed at", async () => {
  const store = open();
  await store.record("/p/a.ts", "one", "save");
  const index = (await tree("files")).find((f) => f.endsWith("index.json"))!;
  await writeFile(join(dir, index), '{"version":1,"entries":[{"id":');
  const swept = await store.sweep();
  expect(swept.removedBlobs).toBe(1);
  expect(await tree("files")).toEqual([]);
  expect(await blobs()).toEqual([]);
});

it("keeps at most the newest 100 versions of a file, dropping the oldest", async () => {
  const store = open({ maxEntriesPerFile: 3 });
  for (const n of [1, 2, 3, 4, 5])
    await store.record("/p/a.ts", `v${n}`, "save");
  const list = await store.list("/p/a.ts");
  expect(
    await Promise.all(list.map((e) => store.read("/p/a.ts", e.id))),
  ).toEqual(["v5", "v4", "v3"]);
  await store.sweep();
  expect(await blobs()).toHaveLength(3);
});

it("drops versions older than the age limit on the next write and on a sweep", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const store = open({ maxAgeMs: 1000 });
  vi.setSystemTime(10_000);
  await store.record("/p/a.ts", "old", "save");
  await store.record("/p/idle.ts", "idle", "save");
  vi.setSystemTime(10_900);
  await store.record("/p/a.ts", "middle", "save");
  vi.setSystemTime(11_500);
  await store.record("/p/a.ts", "new", "save");
  expect((await store.list("/p/a.ts")).map((e) => e.size)).toEqual([3, 6]);
  // A file nobody writes again is pruned by the sweep.
  const result = await store.sweep();
  expect(await store.list("/p/idle.ts")).toEqual([]);
  expect(result).toMatchObject({ files: 1, entries: 2 });
  expect(await blobs()).toHaveLength(2);
});

it("prunes the oldest versions across files once the total passes its cap", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const probe = open();
  vi.setSystemTime(1_000);
  // Incompressible-ish text so each blob is a known size.
  const text = (seed: number) =>
    Array.from({ length: 2000 }, (_, i) => (i * seed * 2654435761) % 997).join(
      ",",
    );
  await probe.record("/p/a.ts", text(1), "save");
  const oneBlob = (await stat(join(dir, (await blobs())[0]!))).size;
  await rm(dir, { recursive: true, force: true });

  const store = open({ maxTotalBytes: oneBlob * 2.5 });
  for (const [i, file] of [
    "/p/a.ts",
    "/p/b.ts",
    "/p/a.ts",
    "/p/c.ts",
  ].entries()) {
    vi.setSystemTime(2_000 + i);
    await store.record(file, text(i + 1), "save");
  }
  const result = await store.sweep();
  expect(result.bytes).toBeLessThanOrEqual(oneBlob * 2.5);
  // The two oldest versions (a's first, b's only) went; the newer ones stayed.
  expect((await store.list("/p/a.ts")).map((e) => e.time)).toEqual([2002]);
  expect(await store.list("/p/b.ts")).toEqual([]);
  expect((await store.list("/p/c.ts")).map((e) => e.time)).toEqual([2003]);
  expect(await blobs()).toHaveLength(2);
});

it("does not free a blob another version still points at", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const store = open({ maxEntriesPerFile: 1 });
  vi.setSystemTime(1_000);
  await store.record("/p/a.ts", "shared", "save");
  vi.setSystemTime(2_000);
  await store.record("/p/b.ts", "shared", "save");
  await store.record("/p/a.ts", "next", "save");
  await store.sweep();
  expect(
    await store.read("/p/b.ts", (await store.list("/p/b.ts"))[0]!.id),
  ).toBe("shared");
});

it("sweeps temporary files from a write that died, but not a fresh one", async () => {
  const store = open();
  await store.record("/p/a.ts", "one", "save");
  const shard = dirname((await blobs())[0]!);
  const stale = join(dir, shard, ".dead.tmp");
  const fresh = join(dir, shard, ".live.tmp");
  await writeFile(stale, "x");
  await writeFile(fresh, "x");
  const longAgo = new Date(Date.now() - 60 * 60 * 1000);
  await utimes(stale, longAgo, longAgo);
  await store.sweep();
  const left = await tree("blobs");
  expect(left.some((f) => f.endsWith(".dead.tmp"))).toBe(false);
  expect(left.some((f) => f.endsWith(".live.tmp"))).toBe(true);
});

it("prunes later, off the write that asked for it", async () => {
  vi.useFakeTimers();
  const store = open({ sweepDelayMs: 1000, maxEntriesPerFile: 1 });
  await store.record("/p/a.ts", "orphan-to-be", "save");
  await store.record("/p/a.ts", "newer", "save");
  // The first entry's text is still on disk: nothing pruned inside the writes.
  expect(await blobs()).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1000);
  await store.list("/p/a.ts");
  expect(await blobs()).toHaveLength(1);
});

it("a first write that fails leaves the file without history", async () => {
  const store = open();
  failing.on = true;
  await expect(store.record("/p/a.ts", "one", "save")).rejects.toThrow("disk full");
  failing.on = false;
  expect(await open().has("/p/a.ts")).toBe(false);
  expect(await store.has("/p/a.ts")).toBe(false);
});
