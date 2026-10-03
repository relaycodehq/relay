import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitWatch } from "./turn-commit";

let root: string, other: string;
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
const commit = async (dir: string, text: string) => {
  await writeFile(join(dir, "a.ts"), text);
  git(dir, "add", "a.ts");
  git(dir, "commit", "-qm", text);
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-turn-commit-")));
  other = await realpath(await mkdtemp(join(tmpdir(), "relay-turn-other-")));
  for (const dir of [root, other]) {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "user.email", "test@example.invalid");
    await commit(dir, "start");
  }
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
});

it("counts a turn that ran git commit and moved HEAD", async () => {
  const watch = await commitWatch([root]);
  watch.command(`git add -A && git commit -q -F - <<'EOF'\nFix it\nEOF`);
  await commit(root, "fixed");
  expect(await watch.ended()).toBe(true);
});

it("ignores a commit someone else made meanwhile, or one that failed", async () => {
  const meanwhile = await commitWatch([root]);
  meanwhile.command("git status --short");
  await commit(root, "another thread");
  expect(await meanwhile.ended()).toBe(false);

  const failed = await commitWatch([root]);
  failed.command("git commit -m 'nothing to commit'");
  expect(await failed.ended()).toBe(false);
});

it("doesn't count a commit the agent kept editing after", async () => {
  const watch = await commitWatch([root]);
  watch.command("git commit -qam wip");
  await commit(root, "wip");
  watch.edited();
  expect(await watch.ended()).toBe(false);
  // Committing again puts it back.
  watch.command("git -C . commit --amend --no-edit");
  expect(await watch.ended()).toBe(true);
});

it("sees a worktree thread landing its commit in the checkout", async () => {
  const watch = await commitWatch([root, other]);
  watch.command(`cd ${other}; git commit -q -m land`);
  await commit(other, "landed");
  expect(await watch.ended()).toBe(true);
});
