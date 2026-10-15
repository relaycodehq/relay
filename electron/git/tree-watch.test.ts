import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noticed, TreeWatch, type TreeWatchDeps } from "./tree-watch";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

let temp: string | undefined;
afterEach(async () => {
  vi.useRealTimers();
  if (temp) await rm(temp, { recursive: true, force: true });
  temp = undefined;
});

it("notices what a working tree shows, not Git's own churn", () => {
  expect(noticed("src/app.ts", false)).toBe(true);
  expect(noticed(".git/index", false)).toBe(true);
  expect(noticed(".git/HEAD", false)).toBe(true);
  expect(noticed(".git/refs/remotes/origin/main", false)).toBe(true);
  expect(noticed(".git/objects/ab/cdef", false)).toBe(false);
  expect(noticed(".git/logs/HEAD", false)).toBe(false);
  expect(noticed(".git/index.lock", false)).toBe(false);
  expect(noticed(".git/FETCH_HEAD", false)).toBe(false);
  expect(noticed(".git/relay/ignored-touches.json", false)).toBe(false);
  expect(noticed(".git/fsmonitor--daemon/cookies/84249-3", false)).toBe(false);
  expect(noticed("web/node_modules/x/index.js", false)).toBe(false);
  expect(noticed("worktrees/feature/HEAD", true)).toBe(true);
  expect(noticed("objects/pack/pack-1.idx", true)).toBe(false);
  expect(noticed(null, false)).toBe(true);
});

/** A watch that changes only when told to, and counts its closes. */
function fakeWatch() {
  const folders: {
    dir: string;
    change(file: string): void;
    fail(): void;
    closed: boolean;
  }[] = [];
  const watch = ((
    dir: string,
    _options: unknown,
    listener: (type: string, file: string) => void,
  ) => {
    const folder = Object.assign(new EventEmitter(), {
      close: () => {
        entry.closed = true;
      },
    });
    const entry = {
      dir,
      change: (file: string) => !entry.closed && listener("change", file),
      fail: () => folder.emit("error", new Error("EMFILE")),
      closed: false,
    };
    folders.push(entry);
    return folder;
  }) as unknown as TreeWatchDeps["watch"];
  return { folders, watch };
}

it("settles a burst into one change and closes once nobody shows it", async () => {
  vi.useFakeTimers();
  const { folders, watch } = fakeWatch();
  const changed = vi.fn();
  const trees = new TreeWatch({
    root: async (where) => `/projects/${where}`,
    changed,
    platform: "darwin",
    watch,
    gitDirs: async (root) => [`${root}/.git`, `${root}/.git`],
  });
  const [main, popped] = [{}, {}];
  expect(await trees.show(main, "a")).toBe(true);
  expect(await trees.show(popped, "a")).toBe(true);
  // One folder for both windows; its .git is inside it.
  expect(folders.map((f) => f.dir)).toEqual(["/projects/a"]);

  folders[0]!.change("src/one.ts");
  folders[0]!.change("src/two.ts");
  folders[0]!.change(".git/index");
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed.mock.calls).toEqual([["a"]]);

  folders[0]!.change(".git/objects/ab/cd");
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed).toHaveBeenCalledTimes(1);

  // An agent writing all the time gets a refresh every 2 s, not every save.
  const at: number[] = [];
  changed.mockImplementation(() => at.push(Date.now()));
  for (let i = 0; i < 40; i++) {
    folders[0]!.change(`src/file-${i}.ts`);
    await vi.advanceTimersByTimeAsync(100);
  }
  await vi.advanceTimersByTimeAsync(2000);
  expect(at.slice(1).map((t, i) => t - at[i]!)).toEqual([2000, 2000]);

  trees.release(main);
  expect(folders[0]!.closed).toBe(false);
  // The popped-out window moves on to another thread.
  expect(await trees.show(popped, "b")).toBe(true);
  expect(folders[0]!.closed).toBe(true);
  expect(folders[1]!.dir).toBe("/projects/b");
  trees.release(popped);
  expect(folders[1]!.closed).toBe(true);
});

it("watches a folder again after it broke, once it can be read", async () => {
  vi.useFakeTimers();
  const { folders, watch } = fakeWatch();
  const changed = vi.fn();
  let gone = false;
  const trees = new TreeWatch({
    root: async (where) => `/projects/${where}`,
    changed,
    platform: "darwin",
    watch,
    gitDirs: async (root) => {
      if (gone) throw new Error("not a git repository");
      return [`${root}/.git`];
    },
  });
  const owner = {};
  expect(await trees.show(owner, "a")).toBe(true);
  gone = true;
  folders[0]!.fail();
  expect(folders[0]!.closed).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed).toHaveBeenCalledTimes(1);
  // Still gone at the first retry; back by the second.
  await vi.advanceTimersByTimeAsync(15_000);
  expect(folders).toHaveLength(1);
  gone = false;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(folders).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed).toHaveBeenCalledTimes(2);
  folders[1]!.change("src/one.ts");
  await vi.advanceTimersByTimeAsync(3000);
  expect(changed).toHaveBeenCalledTimes(3);
  // Nobody shows it any more: no retry left behind.
  folders[1]!.fail();
  trees.release(owner);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(folders).toHaveLength(2);
});

it("leaves Linux, Windows and unreadable folders to the poll", async () => {
  const { watch } = fakeWatch();
  const deps = {
    root: async () => "/projects/a",
    changed: () => {},
    watch,
  };
  for (const platform of ["linux", "win32"] as const)
    expect(await new TreeWatch({ ...deps, platform }).show({}, "a")).toBe(
      false,
    );
  const failing = new TreeWatch({
    ...deps,
    platform: "darwin",
    gitDirs: async () => {
      throw new Error("not a git repository");
    },
  });
  const owner = {};
  expect(await failing.show(owner, "a")).toBe(false);
  expect(await failing.show(owner, "a")).toBe(false);
});

it("sees a commit in a worktree, whose HEAD lives in the main checkout", async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "relay-watch-")));
  const main = join(temp, "main"),
    worktree = join(temp, "worktree");
  const git = (dir: string, ...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  execFileSync("git", ["init", "-q", "-b", "main", main]);
  git(main, "config", "user.email", "t@t");
  git(main, "config", "user.name", "t");
  git(main, "commit", "-q", "--allow-empty", "-m", "one");
  git(main, "worktree", "add", "-q", "-b", "feature", worktree);
  git(worktree, "config", "user.email", "t@t");
  git(worktree, "config", "user.name", "t");

  const changes: string[] = [];
  const trees = new TreeWatch({
    root: async () => worktree,
    changed: (where) => changes.push(where),
    platform: "darwin",
  });
  expect(await trees.show({}, "wt")).toBe(true);
  // FSEvents may still report what happened before the watch started.
  await new Promise((r) => setTimeout(r, 600));
  changes.length = 0;

  git(worktree, "commit", "-q", "--allow-empty", "-m", "two");
  await vi.waitFor(() => expect(changes).toEqual(["wt"]), { timeout: 5000 });

  await mkdir(join(worktree, "src"));
  await writeFile(join(worktree, "src", "new.ts"), "x");
  await vi.waitFor(() => expect(changes).toEqual(["wt", "wt"]), {
    timeout: 5000,
  });
  trees.dispose();
});
