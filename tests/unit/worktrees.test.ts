import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  catchUpWorktree,
  createWorktree,
  landedIn,
  mergeWorktree,
  pullCommit,
  removeWorktree,
  worktreeChanges,
  type MadeWorktree,
} from "../../electron/worktrees";
import type { ChatWorktree } from "../../shared/projects";

let root: string;
let dir: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const read = (path: string) => readFile(path, "utf8");

beforeEach(async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "relay-wt-")));
  root = join(temp, "project");
  dir = join(temp, "worktrees");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  await writeFile(join(root, "a.ts"), "one\ntwo\nthree\nfour\nfive\n");
  await writeFile(join(root, "b.ts"), "bee\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "Initial");
});
afterEach(async () => {
  await rm(join(root, ".."), { recursive: true, force: true });
});

async function made(chatId: string): Promise<MadeWorktree> {
  return createWorktree(root, dir, chatId, "Split the store");
}

it("starts from the checkout's uncommitted edits without counting them as its own", async () => {
  // Another thread's work in progress, one file staged.
  await writeFile(join(root, "a.ts"), "one\ntwo\nthree\nfour\nfive\nwip\n");
  await writeFile(join(root, "new.ts"), "untracked\n");
  git(root, "add", "a.ts");
  const status = git(root, "status", "--porcelain");

  const worktree = await made(randomUUID());
  expect(worktree.branch).toBe("relay/split-the-store");
  expect(await read(join(worktree.path, "a.ts"))).toContain("wip");
  expect(await read(join(worktree.path, "new.ts"))).toBe("untracked\n");
  expect((await worktreeChanges(worktree)).files).toEqual([]);
  // The checkout is left exactly as it was, index included.
  expect(git(root, "status", "--porcelain")).toBe(status);
});

it("merges only the thread's changes, around edits the checkout made since", async () => {
  const chatId = randomUUID();
  const worktree: ChatWorktree = await made(chatId);
  await writeFile(
    join(worktree.path!, "a.ts"),
    "ONE\ntwo\nthree\nfour\nfive\n",
  );
  await writeFile(join(worktree.path!, "c.ts"), "sea\n");
  // Meanwhile another thread edits the same file elsewhere, and another one.
  await writeFile(join(root, "a.ts"), "one\ntwo\nthree\nfour\nFIVE\n");
  await writeFile(join(root, "b.ts"), "bee\nbuzz\n");

  const result = await mergeWorktree(root, chatId, worktree);
  expect(result.conflicts).toEqual([]);
  expect(await read(join(root, "a.ts"))).toBe("ONE\ntwo\nthree\nfour\nFIVE\n");
  expect(await read(join(root, "b.ts"))).toBe("bee\nbuzz\n");
  expect(await read(join(root, "c.ts"))).toBe("sea\n");
  // Nothing committed: it lands like any other uncommitted work.
  expect(git(root, "rev-list", "--count", "HEAD")).toBe("1");

  // Counting from the new base, nothing is left to merge.
  worktree.base = result.base;
  expect((await worktreeChanges(worktree)).files).toEqual([]);
});

it("writes nothing when a file clashes", async () => {
  const chatId = randomUUID();
  const worktree = await made(chatId);
  await writeFile(join(worktree.path, "a.ts"), "one\nTWO\nthree\nfour\nfive\n");
  await writeFile(join(worktree.path, "c.ts"), "sea\n");
  await writeFile(join(root, "a.ts"), "one\ntwo!\nthree\nfour\nfive\n");

  const result = await mergeWorktree(root, chatId, worktree);
  expect(result).toEqual({ conflicts: ["a.ts"] });
  expect(await read(join(root, "a.ts"))).toBe("one\ntwo!\nthree\nfour\nfive\n");
  expect(existsSync(join(root, "c.ts"))).toBe(false);
});

it("sees changes that reached the checkout some other way", async () => {
  const worktree = await made(randomUUID());
  await writeFile(join(worktree.path, "a.ts"), "ONE\ntwo\nthree\nfour\nfive\n");
  const { tree, files } = await worktreeChanges(worktree);
  const paths = files.map((f) => f.path);
  expect(await landedIn(root, worktree.base, tree, paths)).toBe(false);

  // An agent commits it from a terminal, and the checkout moves on after.
  git(worktree.path, "commit", "-qam", "Upper one");
  git(root, "merge", "-q", "--ff-only", worktree.branch);
  await writeFile(join(root, "a.ts"), "ONE\ntwo\nthree\nfour\nfive\nsix\n");
  expect(await landedIn(root, worktree.base, tree, paths)).toBe(true);
});

it("catches up with the checkout, leaving markers only where both changed the same lines", async () => {
  const chatId = randomUUID();
  const worktree: ChatWorktree = await made(chatId);
  await writeFile(
    join(worktree.path!, "a.ts"),
    "one\nTWO\nthree\nfour\nfive\n",
  );
  await writeFile(join(root, "a.ts"), "one\ntwo!\nthree\nfour\nfive\n");
  await writeFile(join(root, "b.ts"), "bee\nbuzz\n");

  const caught = await catchUpWorktree(root, chatId, worktree);
  expect(caught.conflicts).toEqual(["a.ts"]);
  const marked = await read(join(worktree.path!, "a.ts"));
  expect(marked).toContain("<<<<<<< worktree");
  expect(marked).toContain(">>>>>>> checkout");
  expect(await read(join(worktree.path!, "b.ts"))).toBe("bee\nbuzz\n");

  // The agent resolves it; now the merge goes through untouched elsewhere.
  worktree.base = caught.base;
  await writeFile(
    join(worktree.path!, "a.ts"),
    "one\nTWO!\nthree\nfour\nfive\n",
  );
  const result = await mergeWorktree(root, chatId, worktree);
  expect(result.conflicts).toEqual([]);
  expect(await read(join(root, "a.ts"))).toBe("one\nTWO!\nthree\nfour\nfive\n");
  expect(await read(join(root, "b.ts"))).toBe("bee\nbuzz\n");
});

it("makes a PR commit on the checkout's commit, without its uncommitted edits", async () => {
  await writeFile(join(root, "b.ts"), "bee\nsomeone else's wip\n");
  const chatId = randomUUID();
  const worktree = await made(chatId);
  await writeFile(join(worktree.path, "a.ts"), "ONE\ntwo\nthree\nfour\nfive\n");

  await pullCommit(root, chatId, worktree, "Upper-case one");
  const commit = git(worktree.path, "rev-parse", "HEAD");
  expect(git(root, "rev-parse", `${commit}^`)).toBe(worktree.head);
  expect(git(root, "log", "-1", "--format=%s", commit)).toBe("Upper-case one");
  expect(git(root, "show", `${commit}:a.ts`)).toBe(
    "ONE\ntwo\nthree\nfour\nfive",
  );
  expect(git(root, "show", `${commit}:b.ts`)).toBe("bee");
  // The worktree keeps the edits it started with; they just aren't in the PR.
  expect(await read(join(worktree.path, "b.ts"))).toContain(
    "someone else's wip",
  );
});

it("removes the folder and branch but keeps a snapshot of what it held", async () => {
  const chatId = randomUUID();
  const worktree = await made(chatId);
  await writeFile(join(worktree.path, "c.ts"), "sea\n");
  await removeWorktree(root, chatId, worktree);
  expect(existsSync(worktree.path)).toBe(false);
  expect(git(root, "branch", "--list", worktree.branch)).toBe("");
  expect(git(root, "show", `refs/relay/worktrees/${chatId}/kept:c.ts`)).toBe(
    "sea",
  );
});
