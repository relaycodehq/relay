import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  askedTogether,
  noticed,
  TreeWatch,
  type TreeWatchDeps,
} from "./tree-watch";
import { initRepo } from "../../tests/fixtures/git-repo";

/** Real folders, at a pace that doesn't keep the tests waiting. */
const pace = { settleMs: 100, gapMs: 300 };

/** Stands in for the Linux folder-at-a-time watch while set. */
const eachFolder = vi.hoisted(() => ({
  instead: undefined as
    | ((dir: string) => Promise<import("./folder-watch").FolderWatch>)
    | undefined,
}));

vi.mock("./folder-watch", async (load) => {
  const real = await load<typeof import("./folder-watch")>();
  return {
    ...real,
    watchEachFolder: (...args: Parameters<typeof real.watchEachFolder>) =>
      eachFolder.instead?.(args[0]) ?? real.watchEachFolder(...args),
  };
});

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

let temp: string | undefined;

afterEach(async () => {
  eachFolder.instead = undefined;
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
  // Submodules' and worktrees' own Git folders churn the same way.
  expect(noticed(".git/modules/lib/objects/ab/cd", false)).toBe(false);
  expect(noticed(".git/modules/lib/logs/HEAD", false)).toBe(false);
  expect(noticed("modules/vendor/lib/objects/ab", true)).toBe(false);
  expect(noticed("modules/a/modules/b/objects/ab/cd", true)).toBe(false);
  expect(noticed("modules/a/modules/b/hooks", true)).toBe(false);
  expect(noticed("worktrees/feature/logs/HEAD", true)).toBe(false);
  expect(noticed(".git/modules/lib/HEAD", false)).toBe(true);
  expect(noticed("modules/vendor/lib/index", true)).toBe(true);
  expect(noticed("modules/a/modules/b/refs/heads/main", true)).toBe(true);
  expect(noticed("modules/a/refs/heads/logs", true)).toBe(true);
  expect(noticed("worktrees/feature/index", true)).toBe(true);
  expect(noticed(null, false)).toBe(true);
});

it("tells a submodule's name from its Git folder's own entries", () => {
  const modules = new Set([
    ".git/modules/relay",
    ".git/modules/src/hooks",
    ".git/modules/docs/refs/api",
    "modules/a",
    "modules/a/modules/logs",
  ]);
  const isGitDir = (rel: string) => modules.has(rel);
  const seen = (file: string, inGitDir = false) =>
    noticed(file, inGitDir, isGitDir);
  // Named after Git's churn, or after a folder of its own.
  expect(seen(".git/modules/relay/HEAD")).toBe(true);
  expect(seen(".git/modules/relay/objects/ab/cd")).toBe(false);
  expect(seen(".git/modules/src/hooks/index")).toBe(true);
  expect(seen(".git/modules/src/hooks/hooks/pre-commit")).toBe(false);
  expect(seen(".git/modules/docs/refs/api/objects/ab/cdef")).toBe(false);
  expect(seen(".git/modules/docs/refs/api/refs/heads/main")).toBe(true);
  // On Linux each folder on the way to one is watched, and its churn isn't.
  expect(seen(".git/modules/src")).toBe(true);
  expect(seen(".git/modules/src/hooks")).toBe(true);
  expect(seen(".git/modules/relay/logs")).toBe(false);
  // A submodule's own submodules, named the same way.
  expect(seen("modules/a/modules/logs/HEAD", true)).toBe(true);
  expect(seen("modules/a/modules/logs/logs/HEAD", true)).toBe(false);
  expect(seen("modules/a/logs/HEAD", true)).toBe(false);
  // One not made yet ends at the first of Git's entries past its name.
  expect(noticed(".git/modules/relay/HEAD", false)).toBe(true);
  expect(noticed(".git/modules/new/objects/ab", false, isGitDir)).toBe(false);
});

/** A watch that changes only when told to, and counts its closes. */
function fakeWatch() {
  const refuse = new Set<string>();
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
    if (refuse.has(dir)) throw new Error("EMFILE");
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
  return { folders, watch, refuse };
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
  // Told it changed, the window asks again and polls meanwhile.
  expect(await trees.show(owner, "a")).toBe(false);
  // Still gone at the first retry; back by the second, which waits longer.
  await vi.advanceTimersByTimeAsync(15_000);
  expect(folders).toHaveLength(1);
  gone = false;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(folders).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(folders).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(await trees.show(owner, "a")).toBe(true);
  folders[1]!.change("src/one.ts");
  await vi.advanceTimersByTimeAsync(3000);
  expect(changed).toHaveBeenCalledTimes(3);
  // Nobody shows it any more: no retry left behind.
  folders[1]!.fail();
  trees.release(owner);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(folders).toHaveLength(2);
});

it("closes what a retry opened when it fails part-way", async () => {
  vi.useFakeTimers();
  const { folders, watch, refuse } = fakeWatch();
  const trees = new TreeWatch({
    root: async () => "/projects/a",
    changed: () => {},
    platform: "darwin",
    watch,
    gitDirs: async () => ["/projects/main/.git"],
  });
  const owner = {};
  expect(await trees.show(owner, "a")).toBe(true);
  expect(folders.map((f) => f.dir)).toEqual([
    "/projects/a",
    "/projects/main/.git",
  ]);
  refuse.add("/projects/main/.git");
  folders[0]!.fail();
  await vi.advanceTimersByTimeAsync(15_000);
  // The retry watched the folder, then couldn't watch the Git folder.
  expect(folders).toHaveLength(3);
  expect(folders.every((f) => f.closed)).toBe(true);
  refuse.clear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(folders.filter((f) => !f.closed).map((f) => f.dir)).toEqual([
    "/projects/a",
    "/projects/main/.git",
  ]);
  trees.release(owner);
  expect(folders.every((f) => f.closed)).toBe(true);
});

it("stops an open a break overtook, so its retry doesn't watch twice", async () => {
  vi.useFakeTimers();
  const made: { dir: string; folder: EventEmitter; closed: boolean }[] = [];
  let gitDirReady: (() => void) | undefined;
  eachFolder.instead = async (dir) => {
    const folder = Object.assign(new EventEmitter(), {
      close: () => {
        entry.closed = true;
      },
    });
    const entry = { dir, folder, closed: false };
    made.push(entry);
    // The first time, the Git folder's crawl takes a while.
    if (dir.endsWith(".git") && !gitDirReady)
      await new Promise<void>((done) => (gitDirReady = done));
    return folder;
  };
  const trees = new TreeWatch({
    root: async () => "/projects/a",
    changed: () => {},
    platform: "linux",
    gitDirs: async () => ["/projects/main/.git"],
  });
  const owner = {};
  const ready = trees.show(owner, "a");
  await vi.waitFor(() => expect(gitDirReady).toBeDefined());
  // The folder broke while the Git folder was still being crawled.
  made[0]!.folder.emit("error", new Error("ENOENT"));
  gitDirReady!();
  expect(await ready).toBe(false);
  await vi.advanceTimersByTimeAsync(15_000);
  // The retry runs Git for what it ignores before it watches.
  await vi.waitFor(() => expect(made).toHaveLength(4));
  expect(made.filter((w) => !w.closed).map((w) => w.dir)).toEqual([
    "/projects/a",
    "/projects/main/.git",
  ]);
  trees.release(owner);
  expect(made.every((w) => w.closed)).toBe(true);
});

it("watches on Windows, where changes come with backslashes", async () => {
  vi.useFakeTimers();
  const { folders, watch } = fakeWatch();
  const changed = vi.fn();
  const trees = new TreeWatch({
    root: async () => "C:\\projects\\a",
    changed,
    platform: "win32",
    watch,
    gitDirs: async (root) => [`${root}\\.git`],
    isFolder: async () => false,
  });
  expect(await trees.show({}, "a")).toBe(true);
  folders[0]!.change(".git\\objects\\ab\\cd");
  folders[0]!.change("node_modules\\x\\index.js");
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed).not.toHaveBeenCalled();
  folders[0]!.change(".git\\index");
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed.mock.calls).toEqual([["a"]]);
});

it("passes over a folder in Git's own that changed only as an entry came and went", async () => {
  vi.useFakeTimers();
  const { folders, watch } = fakeWatch();
  const changed = vi.fn();
  const trees = new TreeWatch({
    root: async () => "C:\\projects\\a",
    changed,
    platform: "win32",
    watch,
    gitDirs: async (root) => [`${root}\\.git`],
    isFolder: async (path) => /origin$/.test(path),
  });
  expect(await trees.show({}, "a")).toBe(true);
  // A fetch with nothing new: the lock beside origin/HEAD comes and goes.
  folders[0]!.change(".git\\refs\\remotes\\origin\\HEAD.lock");
  folders[0]!.change(".git\\refs\\remotes\\origin");
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed).not.toHaveBeenCalled();
  folders[0]!.change(".git\\refs\\remotes\\origin\\main");
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed.mock.calls).toEqual([["a"]]);
});

it("leaves other systems and unreadable folders to the poll", async () => {
  const { watch } = fakeWatch();
  const deps = {
    root: async () => "/projects/a",
    changed: () => {},
    watch,
  };
  expect(
    await new TreeWatch({ ...deps, platform: "freebsd" }).show({}, "a"),
  ).toBe(false);
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
  initRepo(main);
  git(main, "commit", "-q", "--allow-empty", "-m", "one");
  git(main, "worktree", "add", "-q", "-b", "feature", worktree);
  git(worktree, "config", "user.email", "t@t");
  git(worktree, "config", "user.name", "t");

  const changes: string[] = [];
  const trees = new TreeWatch({
    root: async () => worktree,
    changed: (where) => changes.push(where),
    platform: "darwin",
    pace,
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

it("watches a folder without Git, so its open files see an agent's edits", async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "relay-watch-")));
  const changes: string[] = [];
  const trees = new TreeWatch({
    root: async () => temp!,
    changed: (where) => changes.push(where),
    platform: "darwin",
    pace,
  });
  expect(await trees.show({}, "scratch")).toBe(true);
  await new Promise((r) => setTimeout(r, 600));
  changes.length = 0;

  await writeFile(join(temp, "script.md"), "recorded");
  await vi.waitFor(() => expect(changes).toEqual(["scratch"]), {
    timeout: 5000,
  });
  trees.dispose();
});

it("on Linux, watches each folder Git shows and none it ignores", async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "relay-watch-")));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", temp!, ...args], { stdio: "pipe" });
  execFileSync("git", ["init", "-q", "-b", "main", temp]);
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  await mkdir(join(temp, "src", "deep"), { recursive: true });
  await mkdir(join(temp, "dist"));
  await mkdir(join(temp, "node_modules", "x"), { recursive: true });
  await writeFile(join(temp, ".gitignore"), "dist/\nbuild/\n");
  git("add", ".gitignore");
  git("commit", "-q", "-m", "one");

  const changes: string[] = [];
  const trees = new TreeWatch({
    root: async () => temp!,
    changed: (where) => changes.push(where),
    platform: "linux",
    pace,
  });
  expect(await trees.show({}, "a")).toBe(true);
  await new Promise((r) => setTimeout(r, 600));
  changes.length = 0;
  // Long enough for a change to arrive and settle, were one coming.
  const quiet = async () => {
    await new Promise((r) => setTimeout(r, 700));
    return changes.length;
  };

  await writeFile(join(temp, "dist", "app.js"), "x");
  await writeFile(join(temp, "node_modules", "x", "index.js"), "x");
  expect(await quiet()).toBe(0);

  await writeFile(join(temp, "src", "deep", "a.ts"), "x");
  await vi.waitFor(() => expect(changes).toHaveLength(1), { timeout: 5000 });

  // A folder made after the watch started is followed; an ignored one isn't.
  await mkdir(join(temp, "src", "later"));
  await mkdir(join(temp, "build"));
  await new Promise((r) => setTimeout(r, 700));
  changes.length = 0;
  await writeFile(join(temp, "build", "out.js"), "x");
  expect(await quiet()).toBe(0);
  await writeFile(join(temp, "src", "later", "b.ts"), "x");
  await vi.waitFor(() => expect(changes).toHaveLength(1), { timeout: 5000 });

  git("add", "-A");
  git("commit", "-q", "-m", "two");
  await vi.waitFor(() => expect(changes).toHaveLength(2), { timeout: 5000 });
  trees.dispose();
}, 20_000);

it("tells which of the folders that appeared together Git ignores", async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "relay-watch-")));
  execFileSync("git", ["init", "-q", "-b", "main", temp]);
  await writeFile(join(temp, ".gitignore"), "dist/\nbuild/\n");
  for (const dir of ["dist", "build", "src", "src/dist"])
    await mkdir(join(temp, dir), { recursive: true });
  const ignored = askedTogether(temp);
  expect(
    await Promise.all(["dist", "src", "src/dist", "build"].map(ignored)),
  ).toEqual([true, false, true, true]);
  // Git exits 1 when it ignores none of them.
  expect(await Promise.all(["src"].map(ignored))).toEqual([false]);
});
