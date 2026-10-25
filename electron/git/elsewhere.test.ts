import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outsideEdits, uncommitted } from "./elsewhere";
import { initRepo } from "../../tests/fixtures/git-repo";

let base: string, home: string, clone: string;
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
async function repo(name: string) {
  const root = join(base, name);
  await mkdir(root, { recursive: true });
  initRepo(root);
  await writeFile(join(root, "a.ts"), "one\ntwo\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "Initial");
  return root;
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "relay-elsewhere-")));
  home = await repo("home");
  clone = await repo("clone");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

it("groups edits outside the thread's folder by the repository they're in", async () => {
  await mkdir(join(base, "loose"));
  await mkdir(join(base, ".claude/memory"), { recursive: true });
  await mkdir(join(clone, "src/deep"), { recursive: true });
  const found = await outsideEdits(
    home,
    [
      "a.ts",
      join(home, "b.ts"),
      join(clone, "a.ts"),
      join(clone, "src/deep/gone/file.ts"),
      join(base, "loose/notes.md"),
      join(base, ".claude/memory/fact.md"),
    ],
    [join(base, ".claude")],
  );
  expect(found).toEqual([
    { root: clone, paths: ["a.ts", "src/deep/gone/file.ts"] },
  ]);
});

it("lists only the touched files that are still uncommitted, with their lines", async () => {
  await writeFile(join(clone, "a.ts"), "one\nTWO\nthree\n");
  await writeFile(join(clone, "new.ts"), "x\ny\n");
  await writeFile(join(clone, "other.ts"), "not ours\n");
  const { files, tree } = await uncommitted(clone, [
    "a.ts",
    "new.ts",
    "committed.ts",
  ]);
  expect(tree.branch).toBe("main");
  expect(files).toEqual([
    { path: "a.ts", additions: 2, deletions: 1 },
    { path: "new.ts", additions: 2, deletions: 0, added: true },
  ]);
});

it("counts no lines in an untracked file too big to read", async () => {
  await writeFile(join(clone, "big.log"), "line\n".repeat(300_000));
  await writeFile(join(clone, "small.log"), "line\n".repeat(3));
  const { files } = await uncommitted(clone, ["big.log", "small.log"]);
  expect(files).toEqual([
    { path: "big.log", additions: 0, deletions: 0, added: true },
    { path: "small.log", additions: 3, deletions: 0, added: true },
  ]);
});
