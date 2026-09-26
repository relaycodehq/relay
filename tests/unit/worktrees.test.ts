import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorktree,
  removeWorktree,
  worktreeChanges,
  type MadeWorktree,
} from "../../electron/worktrees";
import { mergeBranch, mergePlan } from "../../electron/branch-merge";
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

async function made(): Promise<MadeWorktree> {
  return createWorktree(root, dir, "Split the store");
}
const paths = async (worktree: ChatWorktree) =>
  (await worktreeChanges(worktree)).files.map((f) => f.path).sort();

it("branches from the checkout's commit, leaving its uncommitted edits behind", async () => {
  await writeFile(join(root, "a.ts"), "one\ntwo\nthree\nfour\nfive\nwip\n");
  await writeFile(join(root, "new.ts"), "untracked\n");
  const status = git(root, "status", "--porcelain");

  const worktree = await made();
  expect(worktree).toMatchObject({
    branch: "relay/split-the-store",
    from: "main",
    start: git(root, "rev-parse", "HEAD"),
  });
  expect(await read(join(worktree.path, "a.ts"))).not.toContain("wip");
  expect(existsSync(join(worktree.path, "new.ts"))).toBe(false);
  expect(await paths(worktree)).toEqual([]);
  expect(git(root, "status", "--porcelain")).toBe(status);
});

it("counts what it committed and what it hasn't, until that lands in main", async () => {
  const worktree = await made();
  await writeFile(join(worktree.path, "b.ts"), "bee\nsting\n");
  git(worktree.path, "commit", "-qam", "Sting");
  await writeFile(join(worktree.path, "c.ts"), "sea\n");
  expect(await paths(worktree)).toEqual(["b.ts", "c.ts"]);
  expect((await worktreeChanges(worktree)).commits).toBe(1);

  git(worktree.path, "add", "c.ts");
  git(worktree.path, "commit", "-qm", "Sea");
  // The checkout keeps working on main meanwhile, in another file.
  await writeFile(join(root, "a.ts"), "one\ntwo\nthree\nfour\nfive\nwip\n");
  const plan = await mergePlan(worktree.path);
  expect(plan).toMatchObject({
    base: "main",
    checkedOutAt: root,
    snapshots: 0,
  });
  expect(
    await mergeBranch(worktree.path, {
      branch: plan.branch,
      head: plan.head,
      base: plan.base,
      baseHead: plan.baseHead,
      push: false,
    }),
  ).toMatchObject({ merged: true, fastForward: true });
  expect(await read(join(root, "c.ts"))).toBe("sea\n");
  expect(await read(join(root, "a.ts"))).toContain("wip");
  expect(await paths(worktree)).toEqual([]);
});

it("keeps counting older snapshot worktrees from their base", async () => {
  const { from, ...worktree } = await made();
  // Before worktrees branched from HEAD they started on a snapshot commit.
  expect(from).toBe("main");
  await writeFile(join(worktree.path, "a.ts"), "snapshot wip\n");
  git(
    worktree.path,
    "commit",
    "-qam",
    "Relay: the checkout's uncommitted edits",
  );
  worktree.base = git(worktree.path, "rev-parse", "HEAD");
  await writeFile(join(worktree.path, "b.ts"), "agent\n");
  expect(await paths(worktree)).toEqual(["b.ts"]);
});

it("removes the folder and branch but keeps a snapshot of what it held", async () => {
  const chatId = randomUUID();
  const worktree = await made();
  await writeFile(join(worktree.path, "c.ts"), "sea\n");
  await removeWorktree(root, chatId, worktree);
  expect(existsSync(worktree.path)).toBe(false);
  expect(git(root, "branch", "--list", worktree.branch)).toBe("");
  expect(git(root, "show", `refs/relay/worktrees/${chatId}/kept:c.ts`)).toBe(
    "sea",
  );
});

it("links the project's ignored node_modules into a new worktree", async () => {
  await writeFile(join(root, ".gitignore"), "node_modules\n");
  git(root, "add", ".gitignore");
  git(root, "commit", "-qm", "Ignore modules");
  await mkdir(join(root, "node_modules", "left-pad"), { recursive: true });

  const worktree = await made();

  expect(existsSync(join(worktree.path, "node_modules", "left-pad"))).toBe(
    true,
  );
  expect(await paths(worktree)).toEqual([]);
});
