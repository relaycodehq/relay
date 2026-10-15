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

const failure = (code: string) => Object.assign(new Error(code), { code });

it("skips a folder it may not read, and fails on running out of watches", async () => {
  await open();
  watches.onWatch = (dir) => {
    if (dir === join(temp, "a")) throw failure("EACCES");
  };
  const folders = await watchEachFolder(
    temp,
    { skip: () => false, budget: 100 },
    () => {},
  );
  expect(watching()).toEqual(["", "/b"]);
  folders.close();

  watches.onWatch = (dir) => {
    if (dir === join(temp, "a", "deep")) throw failure("ENOSPC");
  };
  await expect(
    watchEachFolder(temp, { skip: () => false, budget: 100 }, () => {}),
  ).rejects.toThrow("ENOSPC");
  expect(watching()).toEqual([]);
});

it("fails once watching, rather than leave a hole, when out of watches", async () => {
  await open();
  const folders = await watchEachFolder(
    temp,
    { skip: () => false, skipLater: async () => false, budget: 100 },
    () => {},
  );
  const failed = vi.fn();
  folders.on("error", failed);
  const deep = watches.made.find((w) => w.dir === join(temp, "a", "deep"))!;
  // Gone: only that folder goes.
  deep.folder.emit("error", failure("ENOENT"));
  expect(watching()).toEqual(["", "/a", "/b"]);
  expect(failed).not.toHaveBeenCalled();

  watches.made
    .find((w) => w.dir === join(temp, "b"))!
    .folder.emit("error", failure("ENOSPC"));
  expect(failed).toHaveBeenCalledTimes(1);

  watches.onWatch = (dir) => {
    if (dir === join(temp, "c")) throw failure("EMFILE");
  };
  await mkdir(join(temp, "c"));
  watches.made[0]!.change("rename", "c");
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(2));
  folders.close();
});

it("asks Git about the folders inside one that appears", async () => {
  await open();
  const asked: string[] = [];
  const folders = await watchEachFolder(
    temp,
    {
      skip: () => false,
      skipLater: async (rel) => {
        asked.push(rel);
        return /(^|\/)(dist|\.venv)$/.test(rel);
      },
      budget: 100,
    },
    () => {},
  );
  // Moved in whole, as an unpacked archive or `cp -r` makes it.
  for (const dir of ["c/src/deep", "c/dist/x", "c/.venv/lib", "c/web/dist"])
    await mkdir(join(temp, dir), { recursive: true });
  watches.made[0]!.change("rename", "c");
  await vi.waitFor(() =>
    expect(watching()).toEqual([
      "",
      "/a",
      "/a/deep",
      "/b",
      "/c",
      "/c/src",
      "/c/src/deep",
      "/c/web",
    ]),
  );
  expect(asked).not.toContain("c/dist/x");
  folders.close();
});

it("says so in the log when a folder that appears is past the budget", async () => {
  await open();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const folders = await watchEachFolder(
    temp,
    { skip: () => false, skipLater: async () => false, budget: 5 },
    () => {},
  );
  await mkdir(join(temp, "c", "d", "e"), { recursive: true });
  watches.made[0]!.change("rename", "c");
  await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  expect(watching()).toEqual(["", "/a", "/a/deep", "/b", "/c"]);
  warn.mockRestore();
  folders.close();
});

it("drops a folder that went with what's under it, and nothing else", async () => {
  await open();
  await mkdir(join(temp, "ab"));
  const folders = await watchEachFolder(
    temp,
    { skip: () => false, budget: 100 },
    () => {},
  );
  await rm(join(temp, "a"), { recursive: true });
  watches.made[0]!.change("rename", "a");
  await vi.waitFor(() => expect(watching()).toEqual(["", "/ab", "/b"]));
  folders.close();
});
