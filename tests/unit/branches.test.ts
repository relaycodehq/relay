import { it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branches, changeBranch } from "../../electron/branches";
let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-branches-")));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, "file.ts"), "base\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  git("branch", "feature");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function run(kind: "create" | "switch", name: string) {
  const { current, head } = await branches(root);
  return changeBranch(root, { kind, name, current, head });
}
it("lists branches, creates from current HEAD and preserves local edits", async () => {
  const state = await branches(root);
  expect(state.branches[0]).toMatchObject({ name: "main", current: true });
  await writeFile(join(root, "file.ts"), "unsaved on disk\n");
  const next = await run("create", "new/keep-edits");
  expect(next.current).toBe("new/keep-edits");
  expect(next.head).toBe(state.head);
  expect(await readFile(join(root, "file.ts"), "utf8")).toBe(
    "unsaved on disk\n",
  );
  expect((await run("switch", "refs/heads/main")).current).toBe("main");
});
it("refuses conflicting local changes without stashing or discarding them", async () => {
  git("switch", "feature");
  await writeFile(join(root, "file.ts"), "other\n");
  git("commit", "-qam", "Other");
  git("switch", "main");
  await writeFile(join(root, "file.ts"), "keep me\n");
  await expect(run("switch", "refs/heads/feature")).rejects.toThrow(
    /overwritten/,
  );
  expect(git("branch", "--show-current")).toBe("main");
  expect(await readFile(join(root, "file.ts"), "utf8")).toBe("keep me\n");
});
it("rejects stale selections, invalid names, duplicates and another worktree", async () => {
  const old = await branches(root);
  await run("switch", "refs/heads/feature");
  await expect(
    changeBranch(root, {
      kind: "create",
      name: "stale",
      head: old.head,
      current: old.current,
    }),
  ).rejects.toThrow(/checkout changed/);
  await expect(run("create", "-f")).rejects.toThrow();
  await expect(run("create", "bad..name")).rejects.toThrow();
  await expect(run("create", "main")).rejects.toThrow();
  git("worktree", "add", join(root, "second"), "main");
  await expect(run("switch", "refs/heads/main")).rejects.toThrow(
    /another worktree/,
  );
});
it("creates a tracking branch for a remote ref and skips symbolic remote HEAD", async () => {
  git("remote", "add", "origin", "/unused");
  git("update-ref", "refs/remotes/origin/remote-feature", "HEAD");
  git(
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/remote-feature",
  );
  expect(
    (await branches(root)).branches.some((b) => b.name === "origin/HEAD"),
  ).toBe(false);
  expect(
    (await run("switch", "refs/remotes/origin/remote-feature")).current,
  ).toBe("remote-feature");
  expect(git("config", "branch.remote-feature.remote")).toBe("origin");
});

it("offers origin's default branch first as the base to merge into", async () => {
  const sha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/develop", sha);
  git(
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/develop",
  );

  expect((await branches(root)).bases).toEqual([
    "develop",
    "main",
    "master",
    "trunk",
  ]);
});
