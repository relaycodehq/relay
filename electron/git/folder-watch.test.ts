import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchEachFolder } from "./folder-watch";

/** Watches that change only when told to; real folders are read as they are. */
const watches = vi.hoisted(() => ({
  made: [] as {
    dir: string;
    folder: import("node:events").EventEmitter;
    change(type: string, name: string): void;
    closed: boolean;
  }[],
  /** Runs as a folder is watched; may throw as fs.watch does. */
  onWatch: (_dir: string, _folder: import("node:events").EventEmitter) => {},
}));
vi.mock("node:fs", async (load) => {
  const fs = await load<typeof import("node:fs")>();
  const { EventEmitter } = await import("node:events");
  const watch = (
    dir: string,
    listener: (type: string, name: string) => void,
  ) => {
    const folder = Object.assign(new EventEmitter(), {
      close: () => {
        entry.closed = true;
      },
    });
    watches.onWatch(dir, folder);
    const entry = {
      dir,
      folder,
      change: (type: string, name: string) =>
        !entry.closed && listener(type, name),
      closed: false,
    };
    watches.made.push(entry);
    return folder;
  };
  return { ...fs, default: { ...fs, watch }, watch };
});

let temp: string;
afterEach(async () => {
  watches.made.length = 0;
  watches.onWatch = () => {};
  await rm(temp, { recursive: true, force: true });
});

const open = async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "relay-folders-")));
  await mkdir(join(temp, "a", "deep"), { recursive: true });
  await mkdir(join(temp, "b"));
};
const watching = () =>
  watches.made
    .filter((w) => !w.closed)
    .map((w) => w.dir.slice(temp.length))
    .sort();

it("skips a folder that went between its parent's read and its watch", async () => {
  await open();
  watches.onWatch = (dir) => {
    if (dir === join(temp, "a"))
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
  const folders = await watchEachFolder(
    temp,
    { skip: () => false, budget: 100 },
    () => {},
  );
  expect(watching()).toEqual(["", "/b"]);
  folders.close();
});

it("fails the first crawl when the root's watch breaks during it", async () => {
  await open();
  watches.onWatch = (dir, folder) => {
    // Before the root is read, with nobody listening yet.
    if (dir === temp)
      process.nextTick(() => folder.emit("error", new Error("EMFILE")));
  };
  await expect(
    watchEachFolder(temp, { skip: () => false, budget: 100 }, () => {}),
  ).rejects.toThrow("EMFILE");
  expect(watching()).toEqual([]);
});

it("watches a folder made again under the same name afresh", async () => {
  await open();
  const folders = await watchEachFolder(
    temp,
    { skip: () => false, skipLater: async () => false, budget: 100 },
    () => {},
  );
  expect(watching()).toEqual(["", "/a", "/a/deep", "/b"]);
  const old = watches.made.filter((w) => w.dir.startsWith(join(temp, "a")));
  await rmdir(join(temp, "a", "deep"));
  await rmdir(join(temp, "a"));
  await mkdir(join(temp, "a"));
  watches.made[0]!.change("rename", "a");
  await vi.waitFor(() => expect(watching()).toEqual(["", "/a", "/b"]));
  expect(old.every((w) => w.closed)).toBe(true);
  folders.close();
});
