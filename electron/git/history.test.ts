import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { commitDetail, commitDiff, commitLog } from "./history";
import { layoutGraph } from "../../src/features/changes/commit-graph";
import * as gitCommands from "./git";
import { gitIn, tempRepo } from "../../tests/fixtures/git-repo";
let root: string;
const git = (...args: string[]) => gitIn(root, ...args);

const commit = (message: string) => {
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
};

beforeEach(async () => {
  root = await tempRepo("relay-history-");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("reads an empty repository as no history", async () => {
  expect(await commitLog(root, "head", 50)).toEqual({
    commits: [],
    more: false,
  });
});

it("lays a feature branch and its merge out on two lanes", async () => {
  await writeFile(join(root, "a.txt"), "one\n");
  const base = commit("Base");
  git("switch", "-q", "-c", "feature");
  await writeFile(join(root, "b.txt"), "feature\n");
  const feature = commit("Feature");
  git("switch", "-q", "main");
  await writeFile(join(root, "a.txt"), "two\n");
  const main = commit("Main");
  git("merge", "-q", "--no-ff", "-m", "Merge feature", "feature");
  const merge = git("rev-parse", "HEAD");

  const log = await commitLog(root, "head", 50);
  expect(log.commits.map((c) => c.sha)).toEqual([merge, feature, main, base]);
  expect(log.commits[0].refs).toContainEqual({ name: "main", kind: "head" });
  const rows = layoutGraph(log.commits);
  expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 0]);
  // The merge opens a second lane and the base closes it again.
  expect(rows[0].bottom).toContainEqual(
    expect.objectContaining({ from: 0, to: 1 }),
  );
  expect(rows[3].top).toContainEqual(
    expect.objectContaining({ from: 1, to: 0 }),
  );
  expect(rows[3].bottom).toEqual([]);

  const limited = await commitLog(root, "head", 2);
  expect(limited.commits).toHaveLength(2);
  expect(limited.more).toBe(true);
});

it("shows what a commit changed against its first parent", async () => {
  await writeFile(join(root, "old.txt"), "same\nlines\nhere\n");
  await writeFile(join(root, "gone.txt"), "bye\n");
  const first = commit("First");
  expect((await commitDetail(root, first)).files.map((f) => f.status)).toEqual([
    "A",
    "A",
  ]);
  git("mv", "old.txt", "new.txt");
  git("rm", "-q", "gone.txt");
  await writeFile(join(root, "new.txt"), "same\nlines\nhere\nmore\n");
  const second = commit("Second\n\nWhy it moved.");

  const detail = await commitDetail(root, second);
  expect(detail.subject).toBe("Second");
  expect(detail.body).toBe("Why it moved.");
  expect(detail.files).toEqual([
    {
      path: "gone.txt",
      status: "D",
      additions: 0,
      deletions: 1,
      binary: false,
    },
    {
      path: "new.txt",
      previousPath: "old.txt",
      status: "R",
      additions: 1,
      deletions: 0,
      binary: false,
    },
  ]);
  const renamed = await commitDiff(root, second, "new.txt");
  expect(renamed.old?.name).toBe("old.txt");
  expect(renamed.next?.contents).toBe("same\nlines\nhere\nmore\n");
  expect((await commitDiff(root, second, "gone.txt")).next).toBeNull();
  await expect(commitDiff(root, second, "a.txt")).rejects.toThrow(
    "didn't change",
  );
});

it("tells a local branch with a slash from a remote one", async () => {
  await writeFile(join(root, "a.txt"), "one\n");
  const sha = commit("One");
  git("branch", "feature/login");
  git("tag", "v1");
  git("update-ref", "refs/remotes/origin/main", sha);
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

  const [latest] = (await commitLog(root, "all", 50)).commits;
  expect(latest.refs).toEqual(
    expect.arrayContaining([
      { name: "main", kind: "head" },
      { name: "feature/login", kind: "branch" },
      { name: "origin/main", kind: "remote" },
      { name: "v1", kind: "tag" },
    ]),
  );
  expect(latest.refs).toHaveLength(4);
  expect((await commitDetail(root, sha)).refs).toEqual(latest.refs);
});

it("resolves a selected rename without rereading commit details or line counts", async () => {
  const original = "same\n".repeat(20);
  await writeFile(join(root, "old name.txt"), original);
  await writeFile(join(root, "unchanged.txt"), "unchanged\n");
  const first = commit("First");
  git("mv", "old name.txt", "new name.txt");
  await writeFile(join(root, "new name.txt"), original + "new\n");
  const second = commit(
    "Renamed\n\nLong message irrelevant to file selection.",
  );
  const commands = vi.spyOn(gitCommands, "git");
  expect(await commitDiff(root, second, "new name.txt")).toMatchObject({
    old: { name: "old name.txt", contents: original },
    next: { name: "new name.txt", contents: original + "new\n" },
  });
  // One revision/first-parent lookup and one rename-aware name scan. In
  // particular, restricting diff-tree to the new path would lose the rename.
  expect(commands.mock.calls.map(([, args]) => args[0])).toEqual([
    "show",
    "diff-tree",
  ]);
  expect(commands.mock.calls.flatMap(([, args]) => args)).not.toContain(
    "--numstat",
  );
  await expect(commitDiff(root, second, "unchanged.txt")).rejects.toThrow(
    "didn't change",
  );
  expect(await commitDiff(root, first, "old name.txt")).toMatchObject({
    old: null,
    next: { contents: original },
  });
});
