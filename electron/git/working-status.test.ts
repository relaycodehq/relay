import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { gitIn } from "../../tests/fixtures/git-repo";
import type { WorkingChange } from "../../shared/working-tree";
import { parseStatusV2, statusArgs } from "./working-status";

let root: string, remote: string;
const git = (...args: string[]) => gitIn(root, ...args);
const quiet = (...args: string[]) => {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};

/** The checkout as the five separate reads v2 replaces saw it. */
function before() {
  const raw = quiet("status", "--porcelain=v1", "-z", "--untracked-files=all")!;
  const entries = raw.split("\0"),
    changes: WorkingChange[] = [];
  for (let i = 0; i < entries.length; i++) {
    const row = entries[i];
    if (!row) continue;
    const index = row[0]!,
      worktree = row[1]!;
    const previousPath = /[RC]/.test(index + worktree)
      ? entries[++i]
      : undefined;
    changes.push({
      path: row.slice(3),
      previousPath,
      index,
      worktree,
      conflict:
        /U/.test(index + worktree) || ["AA", "DD"].includes(index + worktree),
    });
  }
  const head = (quiet("rev-parse", "-q", "--verify", "HEAD") ?? "").trim();
  const upstream =
    quiet(
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    )?.trim() || null;
  const counts =
    upstream && head
      ? git("rev-list", "--left-right", "--count", `${upstream}...HEAD`)
          .trim()
          .split(/\s+/)
          .map(Number)
      : null;
  return {
    head,
    branch: git("branch", "--show-current").trim(),
    upstream,
    counts,
    changes,
  };
}

function expectSame() {
  const was = before();
  const now = parseStatusV2(quiet(...statusArgs)!);
  expect(now.changes).toEqual(was.changes);
  expect(now.head).toBe(was.head);
  expect(now.branch).toBe(was.branch);
  // v2 names an upstream that's gone too; it just can't count against it.
  expect(now.ab ? now.upstream : null).toBe(was.counts ? was.upstream : null);
  if (was.counts)
    expect(now.ab).toEqual({ ahead: was.counts[1], behind: was.counts[0] });
  return now;
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-status-")));
  remote = await mkdtemp(join(tmpdir(), "relay-status-origin-"));
  execFileSync("git", ["init", "--bare", "-q", remote]);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", remote);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(remote, { recursive: true, force: true });
});

it("reads a branch with no commits yet as v1 did", async () => {
  expectSame();
  await writeFile(join(root, "new file.ts"), "x\n");
  git("add", ".");
  await writeFile(join(root, "untracked.ts"), "y\n");
  expect(expectSame().head).toBe("");
});

it("reads every kind of change as v1 did, paths with spaces and renames included", async () => {
  await mkdir(join(root, "dir with space"));
  for (const name of ["a.ts", "b.ts", "c.ts", "d.ts", "dir with space/e f.ts"])
    await writeFile(join(root, name), `${name}\n`.repeat(20));
  git("add", ".");
  git("commit", "-qm", "First");
  await writeFile(join(root, "a.ts"), "staged\n");
  git("add", "a.ts");
  await writeFile(join(root, "a.ts"), "then unstaged\n");
  await writeFile(join(root, "b.ts"), "unstaged only\n");
  git("rm", "-q", "c.ts");
  await rm(join(root, "dir with space/e f.ts"));
  git("mv", "d.ts", "renamed d.ts");
  await mkdir(join(root, "deep", "er"), { recursive: true });
  await writeFile(join(root, "deep", "er", "new é.ts"), "new\n");
  await writeFile(join(root, "intent.ts"), "intent\n");
  git("add", "-N", "intent.ts");
  const now = expectSame();
  expect(now.changes.find((c) => c.path === "renamed d.ts")).toMatchObject({
    previousPath: "d.ts",
    index: "R",
  });
});

it("reads merge conflicts as v1 did", async () => {
  await writeFile(join(root, "both.ts"), "base\n");
  await writeFile(join(root, "gone.ts"), "base\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  git("switch", "-qc", "other");
  await writeFile(join(root, "both.ts"), "other\n");
  git("rm", "-q", "gone.ts");
  await writeFile(join(root, "added.ts"), "other\n");
  git("add", ".");
  git("commit", "-qm", "Other");
  git("switch", "-q", "main");
  await writeFile(join(root, "both.ts"), "main\n");
  await writeFile(join(root, "gone.ts"), "changed on main\n");
  await writeFile(join(root, "added.ts"), "main\n");
  git("add", ".");
  git("commit", "-qm", "Main");
  quiet("merge", "other");
  const now = expectSame();
  expect(
    now.changes
      .filter((c) => c.conflict)
      .map((c) => c.path)
      .sort(),
  ).toEqual(["added.ts", "both.ts", "gone.ts"]);
});

it("reads the upstream, its counts, a gone one and a detached HEAD as before", async () => {
  await writeFile(join(root, "a.ts"), "1\n");
  git("add", ".");
  git("commit", "-qm", "One");
  git("push", "-qu", "origin", "main");
  expectSame();
  await writeFile(join(root, "a.ts"), "2\n");
  git("commit", "-qam", "Two");
  expect(expectSame().ab).toEqual({ ahead: 1, behind: 0 });
  // Upstream moves on without this checkout.
  git("push", "-q", "origin", "HEAD:main");
  git("reset", "-q", "--hard", "HEAD~1");
  git("fetch", "-q");
  await writeFile(join(root, "a.ts"), "3\n");
  git("commit", "-qam", "Three");
  expect(expectSame().ab).toEqual({ ahead: 1, behind: 1 });
  // A branch tracking one deleted on the remote.
  git("switch", "-qc", "feature");
  git("push", "-qu", "origin", "feature");
  git("push", "-q", "origin", "--delete", "feature");
  git("fetch", "-q", "--prune");
  expect(expectSame().upstream).toBe("origin/feature");
  // A branch tracking a local one.
  git("switch", "-qc", "local", "--track", "main");
  expectSame();
  git("switch", "-q", "--detach", "HEAD~1");
  expect(expectSame().branch).toBe("");
});
