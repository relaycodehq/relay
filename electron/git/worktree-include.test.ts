import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyIncluded } from "./worktree-include";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

let source: string;
let target: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", source, ...args], { stdio: "pipe" });
const put = async (path: string, text = path) => {
  await mkdir(dirname(join(source, path)), { recursive: true });
  await writeFile(join(source, path), text);
};

beforeEach(async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "relay-inc-")));
  source = join(temp, "project");
  target = join(temp, "worktree");
  await mkdir(target);
  execFileSync("git", ["init", "-q", "-b", "main", source]);
  await put(
    ".gitignore",
    [
      ".env*",
      "!.env.example",
      "vendor/",
      "node_modules/",
      "local/",
      "*.log",
      "",
    ].join("\n"),
  );
  await put("tracked.json", "tracked");
  git("add", ".");
});
afterEach(async () => {
  await rm(join(source, ".."), { recursive: true, force: true });
});

it("copies only files that are both listed and ignored", async () => {
  await put(".worktreeinclude", ".env*\ntracked.json\n.env.example\n");
  await put(".env", "SECRET=1");
  await put(".env.local", "LOCAL=1");
  await put(".env.example", "EXAMPLE=1");
  await put("debug.log");

  expect((await copyIncluded(source, target)).sort()).toEqual([
    ".env",
    ".env.local",
  ]);
  expect(await readFile(join(target, ".env"), "utf8")).toBe("SECRET=1");
  // Tracked or merely untracked files stay in the checkout's hands.
  expect(existsSync(join(target, "tracked.json"))).toBe(false);
  expect(existsSync(join(target, ".env.example"))).toBe(false);
  expect(existsSync(join(target, "debug.log"))).toBe(false);
});

it("copies a listed ignored folder whole, and reaches into one only by name", async () => {
  await put(
    ".worktreeinclude",
    "vendor/\nlocal/settings/*.json\n**/config.json\n",
  );
  await put("vendor/lib/a.php", "a");
  await put("local/settings/dev.json", "{}");
  await put("local/settings/notes.txt");
  await put("node_modules/pkg/config.json", "{}");

  expect((await copyIncluded(source, target)).sort()).toEqual([
    "local/settings/dev.json",
    "vendor/",
  ]);
  expect(await readFile(join(target, "vendor/lib/a.php"), "utf8")).toBe("a");
  expect(existsSync(join(target, "local/settings/notes.txt"))).toBe(false);
  // `**/config.json` doesn't name node_modules, so Relay never walks it.
  expect(existsSync(join(target, "node_modules"))).toBe(false);
});

it("leaves files already in the worktree alone", async () => {
  await put(".worktreeinclude", ".env\n");
  await put(".env", "from checkout");
  await writeFile(join(target, ".env"), "already here");

  expect(await copyIncluded(source, target)).toEqual([]);
  expect(await readFile(join(target, ".env"), "utf8")).toBe("already here");
});

it("does nothing without a .worktreeinclude", async () => {
  await put(".env", "SECRET=1");
  expect(await copyIncluded(source, target)).toEqual([]);
  expect(existsSync(join(target, ".env"))).toBe(false);
});
