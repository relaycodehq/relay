import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempRepo } from "../../tests/fixtures/git-repo";
import { commitFileChange } from "./commit-change";

let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
const text = (l: string[]) => l.join("\n") + "\n";
const base = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
/** Line 5 changed, and line 8, two unchanged lines below it. */
const withA = base.map((l, i) => (i === 4 ? "A" : l));
const withB = base.map((l, i) => (i === 7 ? "B" : l));
const withBoth = withA.map((l, i) => (i === 7 ? "B" : l));

beforeEach(async () => {
  root = await tempRepo("relay-change-");
  await writeFile(join(root, "file.txt"), text(base));
  git("add", ".");
  git("commit", "-qm", "Initial");
  await writeFile(join(root, "file.txt"), text(withBoth));
});

afterEach(() => rm(root, { recursive: true, force: true }));

const commitA = () =>
  commitFileChange(root, {
    path: "file.txt",
    committed: text(base),
    content: text(withA),
    message: "Change A",
  });
/** Stages the file as `lines` without touching the copy on disk. */
function stage(lines: string[]) {
  const blob = execFileSync(
    "git",
    ["-C", root, "hash-object", "-w", "--stdin"],
    {
      input: text(lines),
      encoding: "utf8",
    },
  ).trim();
  git("update-index", "--cacheinfo", `100644,${blob},file.txt`);
}

it("commits one change of a file and leaves the other unstaged on disk", async () => {
  await commitA();

  expect(git("log", "--format=%s")).toBe("Change A\nInitial\n");
  expect(git("show", "HEAD:file.txt")).toBe(text(withA));
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe(text(withBoth));
  expect(git("diff", "--cached")).toBe("");
  expect(git("diff")).toMatch(/^-line 8\n\+B$/m);
  expect(git("diff")).not.toMatch(/^[-+](line 5|A)$/m);
});

it("keeps another change of the file staged, even one a line or two away", async () => {
  stage(withB);

  await commitA();

  expect(git("show", "HEAD:file.txt")).toBe(text(withA));
  expect(git("show", ":file.txt")).toBe(text(withBoth));
  const staged = git("diff", "--cached");
  expect(staged).toMatch(/^-line 8\n\+B$/m);
  expect(staged).not.toMatch(/^[-+](line 5|A)$/m);
  expect(git("diff")).toBe("");
});

it("ends with nothing staged for a change that was staged already", async () => {
  stage(withA);

  await commitA();

  expect(git("show", "HEAD:file.txt")).toBe(text(withA));
  expect(git("diff", "--cached")).toBe("");
  expect(git("status", "--porcelain")).toBe(" M file.txt\n");
});

it("adds a file that isn't in HEAD yet", async () => {
  await writeFile(join(root, "new.txt"), "fresh\n");

  await commitFileChange(root, {
    path: "new.txt",
    committed: "",
    content: "fresh\n",
    message: "Add new",
  });

  expect(git("show", "HEAD:new.txt")).toBe("fresh\n");
  expect(git("status", "--porcelain", "--", "new.txt")).toBe("");
});

it("makes the first commit of a repository that has none", async () => {
  await rm(root, { recursive: true, force: true });
  root = await tempRepo("relay-change-unborn-");
  await writeFile(join(root, "first.txt"), "one\ntwo\n");

  await commitFileChange(root, {
    path: "first.txt",
    committed: "",
    content: "one\n",
    message: "Start",
  });

  expect(git("show", "HEAD:first.txt")).toBe("one\n");
  expect(git("status", "--porcelain")).toBe(" M first.txt\n");
});

it("refuses a stale change, a blank message and no change at all", async () => {
  const change = {
    path: "file.txt",
    committed: text(base),
    content: text(withA),
    message: "Change A",
  };
  await expect(
    commitFileChange(root, { ...change, committed: text(withB) }),
  ).rejects.toThrow(/last commit changed/);
  await expect(
    commitFileChange(root, { ...change, message: "  \n" }),
  ).rejects.toThrow(/message/);
  await expect(
    commitFileChange(root, { ...change, content: text(base) }),
  ).rejects.toThrow(/Nothing to commit/);
  expect(git("log", "--format=%s")).toBe("Initial\n");
  expect(git("diff", "--cached")).toBe("");
});

it("commits CRLF lines byte for byte, whatever autocrlf says", async () => {
  const crlf = (l: string[]) => l.join("\r\n") + "\r\n";
  // Committed with its CRs, as a repository without autocrlf has it.
  git("config", "core.autocrlf", "false");
  await writeFile(join(root, "win.txt"), crlf(["one", "two", "three"]));
  git("add", "win.txt");
  git("commit", "-qm", "Windows file");
  git("config", "core.autocrlf", "true");
  await writeFile(join(root, "win.txt"), crlf(["one", "TWO", "three", "four"]));

  await commitFileChange(root, {
    path: "win.txt",
    committed: crlf(["one", "two", "three"]),
    content: crlf(["one", "TWO", "three"]),
    message: "Shout two",
  });

  const blob = execFileSync("git", [
    "-C",
    root,
    "cat-file",
    "blob",
    "HEAD:win.txt",
  ]);
  expect(blob.toString("utf8")).toBe(crlf(["one", "TWO", "three"]));
  expect(git("diff", "--cached")).toBe("");
});

it("refuses a change right next to a staged edit, and commits nothing", async () => {
  const withNext = base.map((l, i) => (i === 5 ? "staged" : l));
  stage(withNext);

  await expect(commitA()).rejects.toThrow(/staged edits/);

  expect(git("log", "--format=%s")).toBe("Initial\n");
  expect(git("show", ":file.txt")).toBe(text(withNext));
});

it("stages what a commit hook made of the change", async () => {
  // A formatter in pre-commit, as lint-staged runs one.
  const hook = join(root, ".git", "hooks", "pre-commit");
  await writeFile(
    hook,
    '#!/bin/sh\nblob=$(git cat-file blob :file.txt | sed "s/^A$/a/" | git hash-object -w --stdin)\ngit update-index --cacheinfo 100644,$blob,file.txt\n',
    { mode: 0o755 },
  );

  await commitA();

  const formatted = base.map((l, i) => (i === 4 ? "a" : l));
  expect(git("show", "HEAD:file.txt")).toBe(text(formatted));
  expect(git("diff", "--cached")).toBe("");
});

it("keeps the executable bit of a new file", async () => {
  await writeFile(join(root, "run.sh"), "echo hi\n", { mode: 0o755 });

  await commitFileChange(root, {
    path: "run.sh",
    committed: "",
    content: "echo hi\n",
    message: "Add script",
  });

  expect(git("ls-tree", "HEAD", "run.sh")).toMatch(/^100755 /);
  expect(git("ls-files", "--stage", "run.sh")).toMatch(/^100755 /);
});
