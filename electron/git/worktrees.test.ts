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
  adoptWorktree,
  cantCarryOn,
  copiedRef,
  copyIntoWorktree,
  createWorktree,
  moveIntoWorktree,
  newBranchProblem,
  reattachWorktree,
  removeWorktree,
  suggestedBranch,
  worktreeChanges,
  worktreeHoldsWork,
  type MadeWorktree,
} from "./worktrees";
import { mergeBranch, mergePlan } from "./branch-merge";
import type { ChatWorktree } from "../../shared/projects";

// A Git run from inside another repository's hook or bisect would act on that one.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

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

it("moves every uncommitted edit into a new worktree, leaving the checkout at its commit", async () => {
  await writeFile(join(root, ".gitignore"), ".env\n");
  await writeFile(join(root, "gone.ts"), "bye\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "Ignore env");
  await writeFile(join(root, "a.ts"), "one\ntwo\nthree\nfour\nfive\nwip\n");
  await writeFile(join(root, "b.ts"), "staged\n");
  git(root, "add", "b.ts");
  await mkdir(join(root, "src/deep"), { recursive: true });
  await writeFile(join(root, "src/deep/new.ts"), "untracked\n");
  await writeFile(join(root, ".env"), "SECRET=1\n");
  await rm(join(root, "gone.ts"));
  const head = git(root, "rev-parse", "HEAD");

  const worktree = await moveIntoWorktree(root, dir, "Split the store", "c1");

  expect(git(root, "status", "--porcelain")).toBe("");
  expect(existsSync(join(root, "src"))).toBe(false);
  // Ignored files never move.
  expect(await read(join(root, ".env"))).toBe("SECRET=1\n");
  expect(existsSync(join(worktree.path, ".env"))).toBe(false);

  expect(worktree).toMatchObject({ head, start: head, from: "main" });
  expect(await read(join(worktree.path, "a.ts"))).toContain("wip");
  // Unstaged there, as they were here except the one staged edit.
  expect(git(worktree.path, "diff", "--cached", "--name-only")).toBe("");
  expect(git(worktree.path, "status", "--porcelain").split("\n")).toEqual([
    "M a.ts",
    " M b.ts",
    " D gone.ts",
    "?? src/",
  ]);
  expect(await paths(worktree)).toEqual([
    "a.ts",
    "b.ts",
    "gone.ts",
    "src/deep/new.ts",
  ]);
  const kept = git(root, "rev-parse", "refs/relay/worktrees/c1/moved");
  expect(git(root, "show", `${kept}:src/deep/new.ts`)).toBe("untracked");
});

it("leaves a nested repository where it is and moves the rest", async () => {
  const inner = join(root, "inner");
  execFileSync("git", ["init", "-q", "-b", "main", inner]);
  git(inner, "config", "user.name", "Test");
  git(inner, "config", "user.email", "test@example.invalid");
  await writeFile(join(inner, "x.ts"), "x\n");
  git(inner, "add", ".");
  git(inner, "commit", "-qm", "Inner");
  await writeFile(join(root, "a.ts"), "one\ntwo\nthree\nfour\nfive\nwip\n");

  const worktree = await moveIntoWorktree(root, dir, "Split the store", "c1");

  expect(await paths(worktree)).toEqual(["a.ts"]);
  expect(await read(join(worktree.path, "a.ts"))).toContain("wip");
  expect(await read(join(inner, "x.ts"))).toBe("x\n");
  expect(await read(join(root, "a.ts"))).not.toContain("wip");
  expect(existsSync(join(worktree.path, "inner"))).toBe(false);
  expect(git(root, "ls-tree", "refs/relay/worktrees/c1/moved", "inner")).toBe(
    "",
  );
});

it("moves a clean checkout's thread into a fresh worktree", async () => {
  const worktree = await moveIntoWorktree(root, dir, "Split the store", "c1");
  expect(await paths(worktree)).toEqual([]);
  expect(git(root, "status", "--porcelain")).toBe("");
});

const commitSea = async (path: string) => {
  await writeFile(join(path, "c.ts"), "sea\n");
  git(path, "add", "c.ts");
  git(path, "commit", "-qm", "Sea");
};

it("keeps the branch when asked, with the commits on it", async () => {
  const worktree = await made();
  await commitSea(worktree.path);
  const tip = git(worktree.path, "rev-parse", "HEAD");
  await removeWorktree(root, randomUUID(), worktree, { keepBranch: true });
  expect(existsSync(worktree.path)).toBe(false);
  expect(git(root, "rev-parse", worktree.branch)).toBe(tip);
  expect(git(root, "worktree", "list", "--porcelain")).not.toContain(
    worktree.path,
  );
});

it("finds nothing to lose in a clean worktree whose commits are on its branch", async () => {
  await writeFile(join(root, ".gitignore"), "dist\n");
  git(root, "add", ".gitignore");
  git(root, "commit", "-qm", "Ignore dist");
  const worktree = await made();
  await commitSea(worktree.path);
  // Build output Git ignores is no reason to keep it.
  await mkdir(join(worktree.path, "dist"));
  await writeFile(join(worktree.path, "dist", "out.js"), "built\n");
  expect(await worktreeHoldsWork(worktree.path)).toBeUndefined();
});

it("holds work that is uncommitted, untracked or on no branch", async () => {
  const edited = await made();
  await writeFile(join(edited.path, "a.ts"), "changed\n");
  expect(await worktreeHoldsWork(edited.path)).toMatch(/uncommitted/);

  const untracked = await createWorktree(root, dir, "Untracked");
  await writeFile(join(untracked.path, "new.ts"), "new\n");
  expect(await worktreeHoldsWork(untracked.path)).toMatch(/uncommitted/);

  const detached = await createWorktree(root, dir, "Detached");
  git(detached.path, "checkout", "-q", "--detach");
  await commitSea(detached.path);
  expect(await worktreeHoldsWork(detached.path)).toMatch(/no branch/);
  // A branch holding that commit makes it safe again.
  git(detached.path, "branch", "keep-me");
  expect(await worktreeHoldsWork(detached.path)).toBeUndefined();
});

it("refuses the main checkout", async () => {
  expect(await worktreeHoldsWork(root)).toMatch(/linked worktree/);
});

it("checks out a kept branch with commits again, at its old folder", async () => {
  const worktree: ChatWorktree = await made();
  await commitSea(worktree.path!);
  worktree.pr = { number: 7, url: "https://example.invalid/pr/7" };
  await removeWorktree(root, randomUUID(), worktree, { keepBranch: true });
  // The checkout moved on meanwhile.
  await writeFile(join(root, "b.ts"), "bee\nmain\n");
  git(root, "commit", "-qam", "Main moved");

  const back = await reattachWorktree(root, {
    ...worktree,
    removedAt: 1,
    cleanedUp: true,
  });

  expect(back).toEqual(worktree);
  expect(await read(join(worktree.path!, "c.ts"))).toBe("sea\n");
  expect(git(worktree.path!, "branch", "--show-current")).toBe(worktree.branch);
  // Still counted from where it forked, so the thread's changes read as before.
  expect(await paths(back!)).toEqual(["c.ts"]);
});

it("moves a kept branch with nothing of its own up to the checkout", async () => {
  const worktree = await made();
  await removeWorktree(root, randomUUID(), worktree, { keepBranch: true });
  await writeFile(join(root, "b.ts"), "bee\nmain\n");
  git(root, "commit", "-qam", "Main moved");
  const head = git(root, "rev-parse", "HEAD");

  const back = await reattachWorktree(root, { ...worktree, removedAt: 1 });

  expect(back).toEqual({
    path: worktree.path,
    branch: worktree.branch,
    head,
    start: head,
    base: head,
    from: "main",
  });
  expect(await read(join(worktree.path, "b.ts"))).toBe("bee\nmain\n");
});

it("leaves a new worktree to createWorktree when the branch is gone or the folder taken", async () => {
  const worktree = await made();
  await removeWorktree(root, randomUUID(), worktree);
  expect(
    await reattachWorktree(root, { ...worktree, removedAt: 1 }),
  ).toBeUndefined();

  const kept = await createWorktree(root, dir, "Kept");
  await removeWorktree(root, randomUUID(), kept, { keepBranch: true });
  await mkdir(kept.path);
  expect(
    await reattachWorktree(root, { ...kept, removedAt: 1 }),
  ).toBeUndefined();
});

it("copies a checkout's uncommitted edits into a new worktree and leaves the checkout alone", async () => {
  await writeFile(join(root, "a.ts"), "one\ntwo\nthree\nfour\nfive\nwip\n");
  await writeFile(join(root, "b.ts"), "staged\n");
  git(root, "add", "b.ts");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/new.ts"), "untracked\n");
  const status = git(root, "status", "--porcelain");
  const head = git(root, "rev-parse", "HEAD");

  const { worktree, copied } = await copyIntoWorktree(
    root,
    dir,
    "Chat width",
    root,
    "c1",
  );

  expect(copied).toBe(3);
  expect(git(root, "status", "--porcelain")).toBe(status);
  expect(worktree).toMatchObject({ head, start: head, from: "main" });
  expect(await read(join(worktree.path, "a.ts"))).toContain("wip");
  expect(await read(join(worktree.path, "src/new.ts"))).toBe("untracked\n");
  expect(git(worktree.path, "diff", "--cached", "--name-only")).toBe("");
  expect(await paths(worktree)).toEqual(["a.ts", "b.ts", "src/new.ts"]);
  // What was copied stays findable, as the base its own work is measured from.
  const kept = git(root, "rev-parse", copiedRef("c1"));
  expect(git(root, "show", `${kept}:src/new.ts`)).toBe("untracked");
});

it("copies from a thread's own worktree at its commit, counting from its branch", async () => {
  const lead = await made();
  await writeFile(join(lead.path, "b.ts"), "committed by the lead\n");
  git(lead.path, "commit", "-qam", "Lead's work");
  await writeFile(join(lead.path, "a.ts"), "lead wip\n");
  const leadHead = git(lead.path, "rev-parse", "HEAD");

  const { worktree, copied } = await copyIntoWorktree(
    root,
    dir,
    "Child",
    lead.path,
    "c2",
  );

  expect(copied).toBe(1);
  expect(worktree).toMatchObject({ head: leadHead, from: lead.branch });
  expect(await read(join(worktree.path, "b.ts"))).toBe(
    "committed by the lead\n",
  );
  expect(await read(join(worktree.path, "a.ts"))).toBe("lead wip\n");
  // Only the copy is the child's to show; the lead's commit is where it starts.
  expect(await paths(worktree)).toEqual(["a.ts"]);
  expect(git(lead.path, "status", "--porcelain")).toBe("M a.ts");
});

it("a clean source gives a plain worktree at its commit", async () => {
  const { worktree, copied } = await copyIntoWorktree(
    root,
    dir,
    "Clean",
    root,
    "c3",
  );
  expect(copied).toBe(0);
  expect(git(worktree.path, "status", "--porcelain")).toBe("");
});

it("makes the branch the user named, in a folder named after it", async () => {
  const worktree = await createWorktree(root, dir, "Split the store", {
    named: "feature/Store-Split",
  });
  expect(worktree).toMatchObject({
    branch: "feature/Store-Split",
    named: "feature/Store-Split",
    from: "main",
  });
  expect(worktree.path).toBe(join(dir, "project", "feature-store-split"));
  expect(git(worktree.path, "branch", "--show-current")).toBe(
    "feature/Store-Split",
  );
});

it("makes do with relay/… when a named branch can't be made by now, saying why", async () => {
  git(root, "branch", "taken");
  git(root, "branch", "team/a/b");
  for (const [named, problem] of [
    ["taken", "taken already exists."],
    [
      "taken/more",
      "There's a branch called taken, so taken/more can't be made.",
    ],
    ["team/a", "There's a branch called team/a/b, so team/a can't be made."],
    ["my branch", "Branch names can't contain spaces."],
  ]) {
    const worktree = await createWorktree(root, dir, "Split the store", {
      named,
    });
    expect(worktree.branch).toMatch(/^relay\/split-the-store/);
    expect(worktree.named).toBeUndefined();
    expect(worktree.wanted).toEqual({ branch: named, problem });
  }
  expect(await newBranchProblem(root, "team/b")).toBeUndefined();
});

it("suggests the branch createWorktree would pick", async () => {
  expect(await suggestedBranch(root, dir, "Split the store")).toBe(
    "relay/split-the-store",
  );
  const first = await made();
  expect(await suggestedBranch(root, dir, "Split the store")).toBe(
    "relay/split-the-store-2",
  );
  expect((await made()).branch).toBe("relay/split-the-store-2");
  expect(first.named).toBeUndefined();
});

it("checks out a kept user-named branch again, and remakes a removed one on its name", async () => {
  const worktree: ChatWorktree = await createWorktree(root, dir, "Store", {
    named: "feature/store",
  });
  await commitSea(worktree.path!);
  await removeWorktree(root, randomUUID(), worktree, { keepBranch: true });
  const back = await reattachWorktree(root, { ...worktree, removedAt: 1 });
  expect(back).toEqual(worktree);
  expect(git(worktree.path!, "branch", "--show-current")).toBe("feature/store");

  await removeWorktree(root, randomUUID(), back!);
  const again = await createWorktree(root, dir, "Something else", {
    ...back!,
    removedAt: 1,
  });
  expect(again).toMatchObject({
    path: worktree.path,
    branch: "feature/store",
    named: "feature/store",
  });
});

it("remakes a named worktree whose name got taken as relay/… after the thread", async () => {
  const worktree = await createWorktree(root, dir, "Store", {
    named: "feature/store",
  });
  await removeWorktree(root, randomUUID(), worktree, { keepBranch: true });
  // Its branch is checked out somewhere else now, so it can't come back.
  git(
    root,
    "worktree",
    "add",
    "-q",
    join(root, "..", "elsewhere"),
    "feature/store",
  );
  expect(
    await reattachWorktree(root, { ...worktree, removedAt: 1 }),
  ).toBeUndefined();
  const again = await createWorktree(root, dir, "Store again", {
    ...worktree,
    removedAt: 1,
  });
  expect(again.branch).toBe("relay/store-again");
  expect(again.named).toBeUndefined();
});

it("keeps an arriving branch's name when it can, else names it after the thread", async () => {
  const tip = git(root, "rev-parse", "HEAD");
  const kept = await adoptWorktree(root, dir, "store", tip, {
    branch: "feature/store",
  });
  expect(kept).toMatchObject({
    branch: "feature/store",
    named: "feature/store",
  });

  const fallback = await adoptWorktree(root, dir, "store", tip, {
    branch: "feature/store",
  });
  expect(fallback.branch).toBe("relay/store");
  expect(fallback.named).toBeUndefined();
});

it("lets an earlier trip's worktree carry on only when it holds nothing the new tip lacks", async () => {
  const worktree = await createWorktree(root, dir, "Store", {
    named: "feature/store",
  });
  await commitSea(worktree.path);
  const ahead = git(worktree.path, "rev-parse", "HEAD");
  expect(await cantCarryOn(root, worktree, ahead)).toBeUndefined();
  // The tip it would move to is behind its own commit.
  expect(
    await cantCarryOn(root, worktree, git(root, "rev-parse", "HEAD")),
  ).toBe("it has commits on feature/store that never went back");
  await writeFile(join(worktree.path, "d.ts"), "dee\n");
  expect(await cantCarryOn(root, worktree, ahead)).toMatch(/uncommitted/);
});
