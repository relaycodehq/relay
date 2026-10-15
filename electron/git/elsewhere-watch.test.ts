import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
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

it("watches nothing off macOS, so windows poll", async () => {
  const { watch, open } = fakeWatch();
  const watches = new ElsewhereWatch({
    changed: () => {},
    platform: "linux",
    watch,
  });
  watches.show({}, "lead");
  expect(await watches.roots("lead", ["/r/one"])).toBe(false);
  expect(open()).toEqual([]);
});
