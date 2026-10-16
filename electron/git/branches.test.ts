import { it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchCounts, branches, changeBranch } from "./branches";
import type { BranchCounts } from "../../shared/branches";
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
it("lists branches in a repository with no commits yet", async () => {
  const empty = await realpath(await mkdtemp(join(tmpdir(), "relay-unborn-")));
  try {
    execFileSync("git", ["-C", empty, "init", "-q", "-b", "trunk"]);
    expect(await branches(empty)).toMatchObject({ current: "trunk", head: "" });
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
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
it("switches to the local branch a picked remote already has, unless another worktree holds it", async () => {
  git("remote", "add", "origin", "/unused");
  git("update-ref", "refs/remotes/origin/feature", "HEAD");
  expect((await run("switch", "refs/remotes/origin/feature")).current).toBe(
    "feature",
  );
  git("switch", "main");
  git("worktree", "add", join(root, "second"), "feature");
  await expect(run("switch", "refs/remotes/origin/feature")).rejects.toThrow(
    /another worktree/,
  );
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
    "dev",
  ]);
});
it("marks a remote with unrelated history, but not one with an orphan branch", async () => {
  const other = await realpath(await mkdtemp(join(tmpdir(), "relay-other-")));
  const at = (dir: string, ...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  try {
    at(other, "init", "-q", "-b", "main");
    at(
      other,
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Elsewhere",
    );
    git("remote", "add", "old", other);
    git("remote", "add", "origin", root);
    git("fetch", "-q", "old");
    git("switch", "-q", "--orphan", "gh-pages");
    git("commit", "-q", "--allow-empty", "-m", "Pages");
    git("switch", "-q", "main");
    git("fetch", "-q", "origin");
    const state = await branches(root);
    const flag = (name: string) =>
      state.branches.find((b) => b.name === name)?.unrelated;
    expect(flag("old/main")).toBe(true);
    expect(flag("origin/main")).toBe(false);
    expect(flag("origin/gh-pages")).toBe(false);
    expect(flag("feature")).toBe(false);
  } finally {
    await rm(other, { recursive: true, force: true });
  }
});
it("leaves the counting out of the plain list", async () => {
  expect(Object.keys((await branches(root)).branches[0]).sort()).toEqual([
    "current",
    "name",
    "ref",
    "remote",
    "unrelated",
    "worktree",
  ]);
});
it("counts what each branch has over the base, merged on origin counting as in it", async () => {
  git("switch", "-q", "feature");
  for (const n of [1, 2]) {
    await writeFile(join(root, "file.ts"), `feature ${n}\n`);
    git("commit", "-qam", `Feature ${n}`);
  }
  git("switch", "-q", "-c", "done", "main");
  await writeFile(join(root, "done.ts"), "done\n");
  git("add", ".");
  git("commit", "-qm", "Done");
  git("switch", "-q", "main");
  // Merged upstream while the local main hasn't pulled it yet.
  git("update-ref", "refs/remotes/origin/main", git("rev-parse", "done"));
  const list = await branchCounts(root);
  const named = (name: string) => list.branches[name];
  expect(list.compared).toEqual(["main"]);
  expect(named("feature")).toMatchObject({ ahead: 2, behind: 0 });
  expect(named("done")).toMatchObject({
    ahead: 0,
    sha: git("rev-parse", "done"),
  });
  expect(named("main")!.date).toBeGreaterThan(Date.now() - 60_000);
});
it("counts a branch that landed on dev as merged, against dev", async () => {
  git("switch", "-q", "-c", "dev");
  await writeFile(join(root, "dev.ts"), "dev\n");
  git("add", ".");
  git("commit", "-qm", "Dev work");
  git("switch", "-q", "-c", "landed", "main");
  await writeFile(join(root, "landed.ts"), "landed\n");
  git("add", ".");
  git("commit", "-qm", "Landed");
  git("switch", "-q", "dev");
  git("merge", "-q", "--no-edit", "landed");
  const list = await branchCounts(root);
  const named = (name: string) => list.branches[name];
  expect(list.compared).toEqual(["main", "dev"]);
  expect(named("landed")).toMatchObject({ ahead: 0, against: "dev" });
  // Branched off main and not on dev: counted against main.
  expect(named("feature")).toMatchObject({ ahead: 0, against: "main" });
  expect(named("dev")).toMatchObject({ ahead: 0, against: "dev" });
});
it("tells a worktree's branch with no commits yet from one that was merged", async () => {
  git("worktree", "add", "-q", "-b", "fresh", join(root, "wt-fresh"), "main");
  git("worktree", "add", "-q", "-b", "done", join(root, "wt-done"), "main");
  git("-C", join(root, "wt-done"), "branch", "-m", "done-renamed");
  await writeFile(join(root, "wt-done", "done.ts"), "done\n");
  git("-C", join(root, "wt-done"), "add", ".");
  git("-C", join(root, "wt-done"), "commit", "-qm", "Done");
  git("merge", "-q", "--ff-only", "done-renamed");
  git("-C", join(root, "wt-fresh"), "branch", "-m", "fresh-renamed");
  const list = await branchCounts(root);
  const named = (list: BranchCounts, name: string) => list.branches[name];
  expect(named(list, "fresh-renamed")).toMatchObject({
    ahead: 0,
    noCommits: true,
  });
  expect(named(list, "done-renamed")).toMatchObject({ ahead: 0 });
  expect(named(list, "done-renamed")!.noCommits).toBeUndefined();
  // Not checked out anywhere: left as merged.
  expect(named(list, "feature")!.noCommits).toBeUndefined();
});
