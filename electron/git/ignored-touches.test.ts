import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dismissIgnored,
  ignoredDiff,
  ignoredTouches,
  keepIgnored,
  recordIgnored,
} from "./ignored-touches";
import { workingTree } from "./working-tree";

let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const write = async (path: string, text: string) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), text);
};
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-ignored-")));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await write(".gitignore", ".env*.local\ngenerated/\nforced.txt\n");
  await write("a.ts", "one\n");
  await write("forced.txt", "tracked anyway\n");
  git("add", "a.ts", ".gitignore");
  git("add", "-f", "forced.txt");
  git("commit", "-qm", "Initial");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("lists ignored files the agent wrote, with the copy from before its first write", async () => {
  await write(".env.local", "FLAG=false\n");
  await write("generated/client.ts", "v1\n");
  const start = await keepIgnored(root);
  expect(start.folders).toEqual(["generated/"]);

  await write(".env.local", "FLAG=true\n");
  await write("generated/client.ts", "v2\n");
  await write(".env.new.local", "MADE=1\n");
  await write("forced.txt", "tracked, edited\n");
  await write("a.ts", "two\n");
  await recordIgnored(
    root,
    start,
    [
      join(root, ".env.local"),
      "generated/client.ts",
      ".env.new.local",
      "forced.txt",
      "a.ts",
      "../outside.txt",
    ],
    "claude",
  );

  const tree = await workingTree(root);
  expect(tree.ignored).toEqual([
    {
      path: ".env.local",
      agent: "claude",
      before: "kept",
      rule: ".gitignore:1 .env*.local",
    },
    {
      path: "generated/client.ts",
      agent: "claude",
      before: "unknown",
      rule: ".gitignore:2 generated/",
    },
    {
      path: ".env.new.local",
      agent: "claude",
      before: "none",
      rule: ".gitignore:1 .env*.local",
    },
  ]);
  const diff = await ignoredDiff(root, ".env.local");
  expect(diff.old?.contents).toBe("FLAG=false\n");
  expect(diff.next?.contents).toBe("FLAG=true\n");
  expect((await ignoredDiff(root, ".env.new.local")).old).toBeNull();
});

it("keeps the first write's copy across turns and drops a file put back as it was", async () => {
  await write(".env.local", "A\n");
  await write(".env.dev.local", "X\n");
  const first = await keepIgnored(root);
  await write(".env.local", "B\n");
  await write(".env.dev.local", "Y\n");
  await recordIgnored(root, first, [".env.local", ".env.dev.local"], "claude");

  const second = await keepIgnored(root);
  await write(".env.local", "C\n");
  await recordIgnored(root, second, [".env.local"], "codex");
  expect((await ignoredDiff(root, ".env.local")).old?.contents).toBe("A\n");

  const third = await keepIgnored(root);
  await write(".env.dev.local", "X\n");
  await recordIgnored(root, third, [".env.dev.local"], "codex");
  const head = git("rev-parse", "HEAD");
  const { touches } = await ignoredTouches(root, head);
  expect(touches.map((t) => [t.path, t.agent])).toEqual([
    [".env.local", "codex"],
  ]);
});

it("clears at the next commit and on dismiss", async () => {
  await write(".env.local", "A\n");
  const start = await keepIgnored(root);
  await write(".env.local", "B\n");
  await write(".env.dev.local", "B\n");
  await recordIgnored(root, start, [".env.local", ".env.dev.local"], "claude");

  await dismissIgnored(root, [".env.local"]);
  expect((await workingTree(root)).ignored?.map((t) => t.path)).toEqual([
    ".env.dev.local",
  ]);

  await write("a.ts", "two\n");
  git("commit", "-qam", "Next");
  expect((await workingTree(root)).ignored).toBeUndefined();
  await expect(ignoredDiff(root, ".env.dev.local")).rejects.toThrow();
});
