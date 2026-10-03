import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebaseOnUpstream } from "./branch-rebase";

let root: string, remote: string, other: string;
const run = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const git = (...args: string[]) => run(root, ...args);
const commitIn = async (
  dir: string,
  file: string,
  text: string,
  message: string,
) => {
  await writeFile(join(dir, file), text);
  run(dir, "add", file);
  run(dir, "commit", "-qm", message);
};
/** Someone else pushes `file` to origin/main. */
const pushElsewhere = async (file: string, text: string) => {
  await commitIn(other, file, text, `Remote ${file}`);
  run(other, "push", "-q");
};
const rebase = () => rebaseOnUpstream(root, git("rev-parse", "HEAD"));

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-rebase-")));
  remote = await mkdtemp(join(tmpdir(), "relay-rebase-origin-"));
  other = await mkdtemp(join(tmpdir(), "relay-rebase-other-"));
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", remote]);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", remote);
  await commitIn(root, "a.ts", "a\n", "Initial");
  await commitIn(root, "c.ts", "c\n", "Add c");
  git("push", "-qu", "origin", "main");
  run(other, "clone", "-q", remote, ".");
  run(other, "config", "user.name", "Other");
  run(other, "config", "user.email", "other@example.invalid");
});
afterEach(async () => {
  for (const dir of [root, remote, other])
    await rm(dir, { recursive: true, force: true });
});

it("rebases onto the upstream and leaves uncommitted work, staged or not, alone", async () => {
  await pushElsewhere("b.ts", "b\n");
  await commitIn(root, "a.ts", "a1\n", "Mine");
  await writeFile(join(root, "c.ts"), "c staged\n");
  git("add", "c.ts");
  await writeFile(join(root, "c.ts"), "c staged\nand not\n");
  await writeFile(join(root, "wip.ts"), "untracked\n");

  const result = await rebase();

  expect(result.rebased).toBe(true);
  expect(result.tree).toMatchObject({ branch: "main", ahead: 1, behind: 0 });
  expect(git("log", "--format=%s", "-3")).toBe("Mine\nRemote b.ts\nAdd c");
  expect(await readFile(join(root, "b.ts"), "utf8")).toBe("b\n");
  expect(git("status", "--porcelain")).toBe("MM c.ts\n?? wip.ts");
  expect(git("show", ":c.ts")).toBe("c staged");
  expect(git("worktree", "list").split("\n")).toHaveLength(1);
});

it("changes nothing on a conflict, and says what clashed", async () => {
  await pushElsewhere("a.ts", "theirs\n");
  await commitIn(root, "a.ts", "ours\n", "Mine");
  const head = git("rev-parse", "HEAD");

  const result = await rebase();

  expect(result).toMatchObject({
    rebased: false,
    upstream: "origin/main",
    conflicts: ["a.ts"],
  });
  if (result.rebased) return;
  expect(result.incoming.map((c) => c.subject)).toEqual(["Remote a.ts"]);
  expect(result.outgoing.map((c) => c.subject)).toEqual(["Mine"]);
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(git("status", "--porcelain")).toBe("");
  expect(git("worktree", "list").split("\n")).toHaveLength(1);
});

it("refuses rather than overwrite an edit to a file the upstream changed", async () => {
  await pushElsewhere("c.ts", "theirs\n");
  await commitIn(root, "a.ts", "a1\n", "Mine");
  const head = git("rev-parse", "HEAD");
  await writeFile(join(root, "c.ts"), "my edit\n");

  await expect(rebase()).rejects.toThrow(/Uncommitted edits there touch files/);
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(await readFile(join(root, "c.ts"), "utf8")).toBe("my edit\n");
});

it("refuses when the branch moved since the button was drawn", async () => {
  await pushElsewhere("b.ts", "b\n");
  const stale = git("rev-parse", "HEAD");
  await commitIn(root, "a.ts", "a1\n", "Mine");
  await expect(rebaseOnUpstream(root, stale)).rejects.toThrow(
    /checkout changed/,
  );
});
