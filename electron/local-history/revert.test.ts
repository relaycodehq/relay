import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { digest } from "../util/hash";
import { revertToVersion } from "./revert";
import { LocalHistoryStore } from "./store";

let root: string;
let store: LocalHistoryStore;
let file: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-history-revert-")));
  store = new LocalHistoryStore(join(root, ".history"), { sweepDelayMs: null });
  file = join(root, "a.ts");
});
afterEach(async () => {
  store.close();
  await rm(root, { recursive: true, force: true });
});

it("writes the version back, keeping what was there first", async () => {
  const old = (await store.record(file, "old\n", "save"))!;
  await writeFile(file, "current\n");
  const result = await revertToVersion(
    store,
    root,
    "a.ts",
    file,
    old.id,
    digest("current\n"),
  );
  expect(await readFile(file, "utf8")).toBe("old\n");
  expect(result).toEqual({ version: digest("old\n") });
  const list = await store.list(file);
  expect(list.map((e) => [e.reason, e.label])).toEqual([
    ["save", "Reverted"],
    ["before-revert", undefined],
    ["save", undefined],
  ]);
  expect(await store.read(file, list[1]!.id)).toBe("current\n");
});

it("refuses when the file changed since the caller saw it, and keeps both texts", async () => {
  const old = (await store.record(file, "old\n", "save"))!;
  await writeFile(file, "someone else's edit\n");
  await expect(
    revertToVersion(store, root, "a.ts", file, old.id, digest("current\n")),
  ).rejects.toThrow("changed on disk");
  expect(await readFile(file, "utf8")).toBe("someone else's edit\n");
  // Nothing was recorded for an edit that was never replaced.
  expect(await store.list(file)).toHaveLength(1);
});

it("brings back a deleted file when the caller saw it gone", async () => {
  const old = (await store.record(file, "old\n", "save"))!;
  await revertToVersion(store, root, "a.ts", file, old.id, "");
  expect(await readFile(file, "utf8")).toBe("old\n");
});

it("refuses to recreate a file that is there when the caller expected none", async () => {
  const old = (await store.record(file, "old\n", "save"))!;
  await writeFile(file, "back again\n");
  await expect(
    revertToVersion(store, root, "a.ts", file, old.id, ""),
  ).rejects.toThrow("changed on disk");
});

it("says so for a version that is gone", async () => {
  await expect(
    revertToVersion(store, root, "a.ts", file, "nope", ""),
  ).rejects.toThrow("no longer in the history");
});
