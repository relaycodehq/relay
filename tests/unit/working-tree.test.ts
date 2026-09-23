import { beforeEach, afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  realpath,
  mkdtemp,
  writeFile,
  readFile,
  rm,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  workingTree,
  workingDiff,
  performGitAction,
} from "../../electron/working-tree";
let root: string, remote: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-git-")));
  remote = await mkdtemp(join(tmpdir(), "relay-origin-"));
  execFileSync("git", ["init", "--bare", "-q", remote]);
  git("init", "-q", "-b", "review");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", remote);
  await writeFile(join(root, "code.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Initial");
  git("push", "-qu", "origin", "review");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(remote, { recursive: true, force: true });
});
it("keeps partially staged work separate, commits only the index, then pushes explicitly", async () => {
  await writeFile(join(root, "code.ts"), "export const a = 2;\n");
  git("add", "code.ts");
  await writeFile(join(root, "code.ts"), "export const a = 3;\n");
  expect(
    (await workingDiff(root, "code.ts", "staged")).next?.contents,
  ).toContain("= 2");
  expect(
    (await workingDiff(root, "code.ts", "unstaged")).next?.contents,
  ).toContain("= 3");
  let tree = await workingTree(root);
  expect(tree.changes[0]).toMatchObject({ index: "M", worktree: "M" });
  tree = await performGitAction(root, {
    kind: "commit",
    revision: tree.revision,
    message: "Only staged",
  });
  expect(git("show", "HEAD:code.ts")).toContain("= 2");
  expect(await readFile(join(root, "code.ts"), "utf8")).toContain("= 3");
  expect(tree.ahead).toBe(1);
  await performGitAction(root, { kind: "push", revision: tree.revision });
  expect((await workingTree(root)).ahead).toBe(0);
});
it("handles literal odd filenames, renames, deletion and untracked files", async () => {
  const name = ":(glob)* weird\nfile.ts";
  await writeFile(join(root, name), "new\n");
  let tree = await workingTree(root);
  expect((await workingDiff(root, name, "unstaged")).old).toBeNull();
  tree = await performGitAction(root, {
    kind: "stage",
    revision: tree.revision,
    paths: [name],
  });
  expect(tree.changes.find((c) => c.path === name)?.index).toBe("A");
  tree = await performGitAction(root, {
    kind: "unstage",
    revision: tree.revision,
    paths: [name],
  });
  expect(tree.changes.find((c) => c.path === name)?.index).toBe("?");
  await rename(join(root, "code.ts"), join(root, "renamed.ts"));
  git("add", "-A");
  tree = await workingTree(root);
  expect(tree.changes.find((c) => c.path === "renamed.ts")?.previousPath).toBe(
    "code.ts",
  );
  expect((await workingDiff(root, "renamed.ts", "staged")).old?.name).toBe(
    "code.ts",
  );
  await performGitAction(root, {
    kind: "unstage",
    revision: tree.revision,
    paths: ["renamed.ts"],
  });
  expect(
    git("diff", "--cached", "--name-only", "--", "code.ts", "renamed.ts"),
  ).toBe("");
  expect(
    (await workingTree(root)).changes.find((c) => c.path === "code.ts")
      ?.worktree,
  ).toBe("D");
});
it("rejects stale state and non-fast-forward pushes without changing the working files", async () => {
  await writeFile(join(root, "code.ts"), "local\n");
  const old = await workingTree(root);
  await writeFile(join(root, "code.ts"), "changed again\n");
  await expect(
    performGitAction(root, {
      kind: "stage",
      revision: old.revision,
      paths: ["code.ts"],
    }),
  ).rejects.toThrow("checkout changed");
  expect(git("diff", "--cached")).toBe("");
  git("add", ".");
  git("commit", "-qm", "Local");
  const tree = await workingTree(root);
  git("checkout", "--detach", "-q", "HEAD~1");
  await writeFile(join(root, "other"), "remote\n");
  git("add", ".");
  git("commit", "-qm", "Other");
  git("push", "-q", "origin", "HEAD:review");
  git("checkout", "-q", "review");
  await expect(
    performGitAction(root, {
      kind: "push",
      revision: (await workingTree(root)).revision,
    }),
  ).rejects.toThrow(/rejected|fetch first/);
  expect(git("rev-parse", "HEAD")).toBe(tree.head);
});
it("changes its revision when only the staged part of a changed file moves", async () => {
  await writeFile(join(root, "untouched.ts"), "export const u = 1;\n");
  git("add", "untouched.ts");
  git("commit", "-qm", "Second file");
  await writeFile(join(root, "code.ts"), "export const a = 3;\n");
  const stage = (text: string) => {
    const blob = execFileSync(
      "git",
      ["-C", root, "hash-object", "-w", "--stdin"],
      { input: text, encoding: "utf8" },
    ).trim();
    git("update-index", "--cacheinfo", `100644,${blob},code.ts`);
  };
  stage("export const a = 2;\n");
  const before = await workingTree(root);
  // Same status line (MM) and the same working file; only the index differs.
  stage("export const a = 4;\n");
  const after = await workingTree(root);
  expect(after.changes).toEqual(before.changes);
  expect(after.revision).not.toBe(before.revision);
  // Refreshing unchanged files' index stat data is not a change.
  git("update-index", "-q", "--really-refresh");
  expect((await workingTree(root)).revision).toBe(after.revision);
});
