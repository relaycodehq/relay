import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ElsewhereWatch } from "./elsewhere-watch";
import type { TreeWatchDeps } from "./tree-watch";

afterEach(() => {
  vi.useRealTimers();
});

/** A watch that changes only when told to, and says which folders are open. */
function fakeWatch() {
  const folders: { dir: string; change(): void; closed: boolean }[] = [];
  const watch = ((
    dir: string,
    _options: unknown,
    listener: (type: string, file: string) => void,
  ) => {
    const entry = {
      dir,
      change: () => !entry.closed && listener("change", "a.ts"),
      closed: false,
    };
    folders.push(entry);
    return Object.assign(new EventEmitter(), {
      close: () => {
        entry.closed = true;
      },
    });
  }) as unknown as TreeWatchDeps["watch"];
  const open = () => folders.filter((f) => !f.closed).map((f) => f.dir);
  return { folders, watch, open };
}

it("watches the repositories of the thread each window shows, and says which thread changed", async () => {
  vi.useFakeTimers();
  const { folders, watch, open } = fakeWatch();
  const changed = vi.fn();
  const watches = new ElsewhereWatch({
    changed,
    platform: "darwin",
    watch,
    gitDirs: async (root) => [`${root}/.git`],
  });
  const [main, popped] = [{}, {}];
  watches.show(main, "lead");
  watches.show(popped, "other");
  expect(await watches.roots("lead", ["/r/one", "/r/two"])).toBe(true);
  expect(await watches.roots("other", ["/r/two"])).toBe(true);
  expect(open()).toEqual(["/r/one", "/r/two"]);

  folders.find((f) => f.dir === "/r/two")!.change();
  await vi.advanceTimersByTimeAsync(500);
  expect(changed.mock.calls).toEqual([["lead"], ["other"]]);

  // A turn left only the second touched: the first goes unwatched.
  expect(await watches.roots("lead", ["/r/two"])).toBe(true);
  expect(open()).toEqual(["/r/two"]);
  watches.show(main, null);
  expect(open()).toEqual(["/r/two"]);
  watches.release(popped);
  expect(open()).toEqual([]);
  expect(watches.showing(main, "lead")).toBe(false);
});

it("leaves unsupported platforms polling", async () => {
  const { watch, open } = fakeWatch();
  const watches = new ElsewhereWatch({
    changed: () => {},
    platform: "freebsd",
    watch,
  });
  watches.show({}, "lead");
  expect(await watches.roots("lead", ["/r/one"])).toBe(false);
  expect(open()).toEqual([]);
});

it("watches deep changes elsewhere with the Linux backend and releases it when hidden", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-elsewhere-watch-")),
  );
  const changed = vi.fn();
  const watches = new ElsewhereWatch({ changed, platform: "linux" });
  const owner = {};
  try {
    execFileSync("git", ["init", "-q", root]);
    await mkdir(join(root, "src", "deep"), { recursive: true });
    await writeFile(join(root, "src", "deep", "file.txt"), "before");
    watches.show(owner, "lead");
    expect(watches.watches).toBe(true);
    expect(await watches.roots("lead", [root])).toBe(true);
    await writeFile(join(root, "src", "deep", "file.txt"), "after");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith("lead"));
    watches.release(owner);
    changed.mockClear();
    await writeFile(join(root, "src", "deep", "file.txt"), "hidden");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(changed).not.toHaveBeenCalled();
    expect(watches.showing(owner, "lead")).toBe(false);
  } finally {
    watches.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

it("falls back to polling when a Linux repository cannot be watched", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-elsewhere-missing-"));
  await rm(root, { recursive: true, force: true });
  const watches = new ElsewhereWatch({ changed: vi.fn(), platform: "linux" });
  try {
    watches.show({}, "lead");
    expect(await watches.roots("lead", [root])).toBe(false);
  } finally {
    watches.dispose();
  }
});
