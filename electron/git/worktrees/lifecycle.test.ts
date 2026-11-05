import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitIn, tempRepo } from "../../../tests/fixtures/git-repo";
import { createWorktree } from "./create";
import { removeWorktree } from "./lifecycle";

const snapshots = vi.hoisted(() => ({ fail: false }));

vi.mock("../turn-snapshots", async (original) => {
  const real = await original<typeof import("../turn-snapshots")>();
  return {
    ...real,
    snapshotTree: (...args: Parameters<typeof real.snapshotTree>) =>
      snapshots.fail
        ? Promise.reject(new Error("index.lock exists"))
        : real.snapshotTree(...args),
  };
});

// A Git run from inside another repository's hook would act on that one.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

let root: string;

beforeEach(async () => {
  snapshots.fail = false;
  root = await tempRepo("relay-lifecycle-");
  await writeFile(join(root, "a.ts"), "one\n");
  gitIn(root, "add", ".");
  gitIn(root, "commit", "-qm", "Initial");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(`${root}-wt`, { recursive: true, force: true });
});

it("keeps a worktree with changes it couldn't save a copy of", async () => {
  const worktree = await createWorktree(root, `${root}-wt`, "Split it");
  await writeFile(join(worktree.path, "c.ts"), "sea\n");
  snapshots.fail = true;

  await expect(removeWorktree(root, "chat", worktree)).rejects.toThrow(
    "Couldn't save a copy of this worktree's changes, so it wasn't removed",
  );
  expect(existsSync(join(worktree.path, "c.ts"))).toBe(true);
  expect(gitIn(root, "branch", "--list", worktree.branch)).not.toBe("");
});

it("keeps a worktree Git can't read any more and says what to do", async () => {
  const worktree = await createWorktree(root, `${root}-wt`, "Split it");
  await writeFile(join(worktree.path, "c.ts"), "sea\n");
  // The repository lost track of it, as when the project folder moves.
  await rm(join(root, ".git", "worktrees"), { recursive: true, force: true });
  snapshots.fail = true;

  await expect(removeWorktree(root, "chat", worktree)).rejects.toThrow(
    "Git can't read this worktree any more",
  );
  expect(existsSync(join(worktree.path, "c.ts"))).toBe(true);
});

it("removes a clean worktree even when it couldn't save a copy", async () => {
  const worktree = await createWorktree(root, `${root}-wt`, "Split it");
  snapshots.fail = true;

  await removeWorktree(root, "chat", worktree);
  expect(existsSync(worktree.path)).toBe(false);
});
