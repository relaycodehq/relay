import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  catchUpBranch,
  deleteMergedBranch,
  mergeBranch,
  mergePlan,
} from "../../electron/branch-merge";

let root: string, remote: string, other: string;
const run = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const git = (...args: string[]) => run(root, ...args);
const commit = async (file: string, text: string, message: string) => {
  await writeFile(join(root, file), text);
  git("add", file);
  git("commit", "-qm", message);
};
const merge = async (push = true) => {
  const plan = await mergePlan(root);
  return mergeBranch(root, {
    branch: plan.branch,
    head: plan.head,
    base: plan.base,
    baseHead: plan.baseHead,
    push,
  });
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-merge-")));
  remote = await mkdtemp(join(tmpdir(), "relay-merge-origin-"));
  other = await mkdtemp(join(tmpdir(), "relay-merge-other-"));
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", remote]);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", remote);
  await commit("a.ts", "a\n", "Initial");
  git("push", "-qu", "origin", "main");
  git("switch", "-qc", "feature");
});
afterEach(async () => {
  for (const dir of [root, remote, other])
    await rm(dir, { recursive: true, force: true });
});

it("fast-forwards main and pushes it without leaving the branch", async () => {
  await commit("b.ts", "b\n", "Add b");
  await writeFile(join(root, "wip.ts"), "not done\n");
  const plan = await mergePlan(root);
  expect(plan).toMatchObject({
    base: "main",
    fastForward: true,
    pushTarget: "origin/main",
    uncommitted: 1,
  });
  expect(plan.commits.map((c) => c.subject)).toEqual(["Add b"]);
  const result = await merge();
  expect(result).toMatchObject({ merged: true, fastForward: true });
  expect(git("rev-parse", "main")).toBe(git("rev-parse", "feature"));
  expect(run(remote, "rev-parse", "main")).toBe(git("rev-parse", "feature"));
  expect(git("branch", "--show-current")).toBe("feature");
  expect(await readFile(join(root, "wip.ts"), "utf8")).toBe("not done\n");
});

it("makes a merge commit on top of what the remote has", async () => {
  await commit("b.ts", "b\n", "Add b");
  // Someone else pushed to main meanwhile; local main doesn't know yet.
  run(other, "clone", "-q", remote, ".");
  run(other, "config", "user.name", "Other");
  run(other, "config", "user.email", "other@example.invalid");
  await writeFile(join(other, "c.ts"), "c\n");
  run(other, "add", "c.ts");
  run(other, "commit", "-qm", "Add c");
  run(other, "push", "-q", "origin", "main");
  const result = await merge();
  expect(result).toMatchObject({ merged: true, fastForward: false });
  expect(git("log", "-1", "--format=%s", "main")).toBe(
    "Merge branch 'feature' into main",
  );
  expect(git("ls-tree", "--name-only", "main").split("\n")).toEqual([
    "a.ts",
    "b.ts",
    "c.ts",
  ]);
  expect(run(remote, "rev-parse", "main")).toBe(git("rev-parse", "main"));
  expect(git("worktree", "list").split("\n")).toHaveLength(1);
});

it("reports conflicts and changes nothing", async () => {
  await commit("a.ts", "feature\n", "Feature a");
  git("switch", "-q", "main");
  await commit("a.ts", "main\n", "Main a");
  git("switch", "-q", "feature");
  const before = git("rev-parse", "main");
  expect(await merge(false)).toEqual({ merged: false, conflicts: ["a.ts"] });
  expect(git("rev-parse", "main")).toBe(before);
  expect(git("status", "--porcelain")).toBe("");
  expect(git("worktree", "list").split("\n")).toHaveLength(1);
});

it("has nothing to merge into from main itself", async () => {
  git("switch", "-q", "main");
  await expect(mergePlan(root)).rejects.toThrow("is the main branch");
});

it("fast-forwards a main open in another folder, around its uncommitted edits", async () => {
  await commit("b.ts", "b\n", "Add b");
  await rm(other, { recursive: true, force: true });
  git("worktree", "add", "-q", other, "main");
  await writeFile(join(other, "a.ts"), "wip\n");
  expect(await merge()).toMatchObject({
    merged: true,
    pushedTo: "origin/main",
  });
  expect(run(other, "rev-parse", "HEAD")).toBe(git("rev-parse", "feature"));
  expect(await readFile(join(other, "b.ts"), "utf8")).toBe("b\n");
  expect(await readFile(join(other, "a.ts"), "utf8")).toBe("wip\n");
  expect(run(remote, "rev-parse", "main")).toBe(git("rev-parse", "feature"));
});

it("stops before pushing when that folder has edits to a file the merge changes", async () => {
  await commit("a.ts", "feature\n", "Change a");
  await rm(other, { recursive: true, force: true });
  git("worktree", "add", "-q", other, "main");
  await writeFile(join(other, "a.ts"), "wip\n");
  const before = git("rev-parse", "main");
  await expect(merge()).rejects.toThrow("uncommitted edits");
  expect(git("rev-parse", "main")).toBe(before);
  expect(run(remote, "rev-parse", "main")).toBe(before);
  expect(await readFile(join(other, "a.ts"), "utf8")).toBe("wip\n");
});

it("catches up with main, leaving conflicts marked to resolve", async () => {
  await commit("a.ts", "feature\n", "Feature a");
  git("switch", "-q", "main");
  await commit("a.ts", "main\n", "Main a");
  await commit("c.ts", "c\n", "Add c");
  git("switch", "-q", "feature");
  expect(await catchUpBranch(root, "main")).toEqual({ conflicts: ["a.ts"] });
  expect(await readFile(join(root, "a.ts"), "utf8")).toContain("<<<<<<<");
  expect(await readFile(join(root, "c.ts"), "utf8")).toBe("c\n");
});

it("deletes the branch once merged, never the current one", async () => {
  await commit("b.ts", "b\n", "Add b");
  await merge(false);
  await expect(deleteMergedBranch(root, "feature")).rejects.toThrow(
    "Switch to another branch",
  );
  git("switch", "-q", "main");
  await deleteMergedBranch(root, "feature");
  expect(git("branch", "--list", "feature")).toBe("");
});
