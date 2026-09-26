import { it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitDetail, commitDiff, commitLog } from "../../electron/history";
import { layoutGraph } from "../../src/lib/commit-graph";
let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
const commit = (message: string) => {
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
};
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-history-")));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "relay@example.com");
  git("config", "user.name", "Relay");
});
afterEach(() => rm(root, { recursive: true, force: true }));

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
