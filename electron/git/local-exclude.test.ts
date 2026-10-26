import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempRepo } from "../../tests/fixtures/git-repo";
import { excludeLocally } from "./local-exclude";

let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

beforeEach(async () => {
  root = await tempRepo("relay-exclude-");
});
afterEach(() => rm(root, { recursive: true, force: true }));

it("keeps a folder out of the changes at any depth", async () => {
  for (const dir of [".cache/clangd/index", "build/.cache/clangd/index"]) {
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, dir, "main.cpp.idx"), "index");
  }
  await writeFile(join(root, "main.cpp"), "int main() {}\n");

  await excludeLocally(root, "**/.cache/clangd/");

  expect(git("status", "--porcelain", "-uall")).toBe("?? main.cpp\n");
});

it("writes the pattern once, after whatever the exclude file had", async () => {
  const file = join(root, ".git", "info", "exclude");
  await writeFile(file, "# mine\n*.log");

  await excludeLocally(root, "**/.cache/clangd/");
  await excludeLocally(root, "**/.cache/clangd/");

  expect(await readFile(file, "utf8")).toBe("# mine\n*.log\n**/.cache/clangd/\n");
});
