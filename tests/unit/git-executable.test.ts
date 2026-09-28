import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitInfo, gitVersion, setGitPath } from "../../electron/git";
import { isGitMissing } from "../../shared/working-tree";

afterEach(() => setGitPath(null));

it("finds Git by itself", async () => {
  const info = await gitInfo();
  expect(info).toMatchObject({ chosen: false, error: null });
  expect(info.version).toMatch(/^git version/);
});

it("says Git is missing when the chosen one is gone", async () => {
  setGitPath(join(tmpdir(), "no-such-git", "git.exe"));
  const failure = await git(process.cwd(), ["--version"]).catch((e) => e);
  expect(isGitMissing(failure)).toBe(true);
  expect(await gitInfo()).toMatchObject({ chosen: true, version: null });
  setGitPath(null);
  expect((await gitInfo()).version).toMatch(/^git version/);
});

it("won't take a program that isn't Git", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-not-git-"));
  try {
    const file = join(dir, "notes.txt");
    await writeFile(file, "not a program");
    await expect(gitVersion(file)).rejects.toThrow(/Git/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
