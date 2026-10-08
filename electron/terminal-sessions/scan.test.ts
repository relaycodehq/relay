import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileCache, headLines } from "./scan";

it("reads a file again only once it changes, and shares a read in flight", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-scan-"));
  try {
    const path = join(dir, "a.jsonl");
    await writeFile(path, "one\n");
    let reads = 0;
    const cache = new FileCache<number>();
    const read = async () => ++reads;
    expect(
      await Promise.all([cache.get(path, read), cache.get(path, read)]),
    ).toEqual([1, 1]);
    expect(await cache.get(path, read)).toBe(1);
    await writeFile(path, "one\ntwo\n");
    expect(await cache.get(path, read)).toBe(2);
    // Same size, new time.
    await utimes(path, new Date(), new Date(Date.now() + 5000));
    expect(await cache.get(path, read)).toBe(3);
    // A failed read is tried again.
    await expect(
      cache.get(path, async () => Promise.reject(new Error("x")), {
        mtime: 1,
        size: 1,
      }),
    ).rejects.toThrow();
    expect(await cache.get(path, read, { mtime: 1, size: 1 })).toBe(4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps only the whole lines of a head", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-scan-"));
  try {
    const path = join(dir, "a.jsonl");
    await writeFile(path, "first\nsecond line\n");
    expect(await headLines(path, 10)).toEqual(["first"]);
    expect(await headLines(path)).toEqual(["first", "second line"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
