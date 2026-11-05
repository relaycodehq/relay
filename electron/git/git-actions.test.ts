import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performGitAction } from "./git-actions";
import { workingTree } from "./working-tree";
import { gitIn } from "../../tests/fixtures/git-repo";
import { writeLongPaths } from "../../tests/fixtures/long-paths";

let root: string;
const git = (...args: string[]) => gitIn(root, ...args);

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-commit-")));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("commit", "-q", "--allow-empty", "-m", "Initial");
});

afterEach(() => rm(root, { recursive: true, force: true }));

it("commits more picked files than fit on a command line", async () => {
  const paths = await writeLongPaths(root);
  await writeFile(join(root, "left-out.ts"), "not picked");
  const tree = await workingTree(root);

  await performGitAction(root, {
    kind: "commit",
    revision: tree.revision,
    message: "Many files",
    paths,
  });

  expect(git("diff", "--shortstat", "HEAD~", "HEAD")).toMatch(
    /^1500 files changed/,
  );
  expect(git("status", "--porcelain")).toBe("?? left-out.ts");
}, 60000);
