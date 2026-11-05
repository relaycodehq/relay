import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree, worktreeChanges } from ".";
import type { ChatWorktree } from "../../../shared/projects";
import { initRepo } from "../../../tests/fixtures/git-repo";
import { gitRuns } from "../../../tests/fixtures/git-runs";

// A Git run from inside another repository's hook or bisect would act on that one.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

let temp: string, root: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "relay-wtc-")));
  root = join(temp, "project");
  initRepo(root);
  await writeFile(join(root, "a.ts"), "one\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "Initial");
});

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

const made = (): Promise<ChatWorktree> =>
  createWorktree(root, join(temp, "worktrees"), "Count runs");

const paths = async (worktree: ChatWorktree) =>
  (await worktreeChanges(worktree)).files.map((f) => f.path).sort();

// The thread's worktree card asks every 5s while it shows; each ask used to
// write a whole snapshot of the worktree (add -A, write-tree) and diff it.
it.skipIf(process.platform === "win32")(
  "asks Git once while nothing in the worktree or its source branch moved",
  async () => {
    const worktree = await made();
    await writeFile(join(worktree.path!, "b.ts"), "bee\n");
    await worktreeChanges(worktree);
    expect(await gitRuns(() => worktreeChanges(worktree))).toEqual(["status"]);
  },
);

it("sees every move behind the answer it keeps", async () => {
  const worktree = await made();
  const path = worktree.path!;
  const lines = async () =>
    (await worktreeChanges(worktree)).files.map(
      (f) => `${f.path} +${f.additions}`,
    );
  await writeFile(join(path, "b.ts"), "bee\n");
  expect(await lines()).toEqual(["b.ts +1"]);
  // The same file written again, with the same set of changed paths.
  await writeFile(join(path, "b.ts"), "bee\nsting\n");
  expect(await lines()).toEqual(["b.ts +2"]);
  // Committed: nothing on disk differs from HEAD any more.
  git(path, "add", ".");
  git(path, "commit", "-qm", "Bee");
  expect(await lines()).toEqual(["b.ts +2"]);
  // The source branch takes it: nothing left that main doesn't have.
  git(root, "merge", "-q", "--ff-only", worktree.branch!);
  expect(await paths(worktree)).toEqual([]);
  // Back to a change after the merge, and gone again once reverted.
  await writeFile(join(path, "a.ts"), "one\ntwo\n");
  expect(await paths(worktree)).toEqual(["a.ts"]);
  git(path, "checkout", "--", "a.ts");
  expect(await paths(worktree)).toEqual([]);
});

it.skipIf(process.platform === "win32")(
  "snapshots each time a nested repository could have moved",
  async () => {
    const worktree = await made();
    const inner = join(worktree.path!, "inner");
    initRepo(inner);
    await writeFile(join(inner, "x.ts"), "x\n");
    git(inner, "add", ".");
    git(inner, "commit", "-qm", "Inner");
    await worktreeChanges(worktree);
    expect(await gitRuns(() => worktreeChanges(worktree))).toContain(
      "write-tree",
    );
  },
);

it.skipIf(process.platform === "win32")(
  "snapshots again when a submodule that status ignores moved",
  async () => {
    const worktree = await made();
    const path = worktree.path!;
    const inner = join(temp, "inner");
    initRepo(inner);
    await writeFile(join(inner, "x.ts"), "x\n");
    git(inner, "add", ".");
    git(inner, "commit", "-qm", "Inner");
    git(
      path,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      inner,
      "sub",
    );
    git(path, "commit", "-qm", "Sub");
    git(path, "config", "submodule.sub.ignore", "all");
    const sub = join(path, "sub");
    initRepo(sub);
    const before = (await worktreeChanges(worktree)).tree;
    await writeFile(join(sub, "y.ts"), "y\n");
    git(sub, "add", ".");
    git(sub, "commit", "-qm", "Moved");
    expect((await worktreeChanges(worktree)).tree).not.toBe(before);
  },
);

it.skipIf(process.platform === "win32")(
  "snapshots for the card without the clean filter the repository's config names",
  async () => {
    const marker = join(temp, "filter-ran");
    // Before anything reads the worktree: Relay asks about filters once a minute.
    git(root, "config", "filter.x.clean", `touch '${marker}'; cat`);
    const worktree = await made();
    await writeFile(join(worktree.path!, ".gitattributes"), "*.ts filter=x\n");
    await writeFile(join(worktree.path!, "a.ts"), "changed\n");
    expect(await paths(worktree)).toEqual([".gitattributes", "a.ts"]);
    expect(existsSync(marker)).toBe(false);
  },
);
