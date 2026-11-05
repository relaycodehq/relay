import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitIn, tempRepo } from "../../tests/fixtures/git-repo";
import { gitEnv, gitExecutable } from "./git";
import { filterOverride } from "./filter-guard";
import { workingTree } from "./working-tree";

let repo: string;
let marker: string;

beforeEach(async () => {
  repo = await tempRepo("relay-filter-");
  marker = join(repo, "..", `${repo.split("/").pop()}-filter-ran`);
  await writeFile(join(repo, "a.txt"), "a\n");
  await writeFile(join(repo, ".gitattributes"), "a.txt filter=x\n");
  gitIn(repo, "add", ".");
  gitIn(repo, "commit", "-qm", "init");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(marker, { force: true });
});

/** A folder handed over whole brings its own .git/config, filter commands and all. */
function configureFilter(name: string, key: string) {
  gitIn(repo, "config", `filter.${name}.${key}`, `touch '${marker}'; cat`);
  gitIn(repo, "config", `filter.${name}.required`, "true");
}

it.skipIf(process.platform === "win32")(
  "polls a repository without running the clean filter its config names",
  async () => {
    configureFilter("x", "clean");
    await writeFile(join(repo, "a.txt"), "changed\n");
    expect((await workingTree(repo)).changes.map((c) => c.path)).toEqual([
      "a.txt",
    ]);
    expect(existsSync(marker)).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "switches off a filter whose name -c can't spell",
  async () => {
    await writeFile(join(repo, ".gitattributes"), "a.txt filter=x=y\n");
    gitIn(repo, "commit", "-qam", "rename filter");
    configureFilter("x=y", "clean");
    await writeFile(join(repo, "a.txt"), "changed\n");
    await workingTree(repo).catch(() => undefined);
    expect(existsSync(marker)).toBe(false);
  },
);

const lfsInstalled = (() => {
  try {
    execFileSync("git-lfs", ["version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

it.skipIf(!lfsInstalled)(
  "doesn't call a touched LFS file modified",
  async () => {
    gitIn(repo, "lfs", "install", "--local");
    gitIn(repo, "lfs", "track", "*.bin");
    await writeFile(join(repo, "big.bin"), "large content\n");
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-qm", "lfs");
    expect(gitIn(repo, "cat-file", "-p", "HEAD:big.bin")).toContain("git-lfs");
    // A new mtime makes Git run the clean filter to compare the content.
    const later = new Date(Date.now() + 5000);
    await utimes(join(repo, "big.bin"), later, later);
    expect((await workingTree(repo)).changes).toEqual([]);
  },
);

it.skipIf(!lfsInstalled || process.platform === "win32")(
  "doesn't let an LFS extension in the repository's config run",
  async () => {
    gitIn(repo, "lfs", "install", "--local");
    gitIn(repo, "lfs", "track", "*.bin");
    await writeFile(join(repo, "big.bin"), "large content\n");
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-qm", "lfs");
    const extension = join(repo, "..", `${repo.split("/").pop()}-ext.sh`);
    await writeFile(extension, `#!/bin/sh\ntouch '${marker}'\ncat\n`, {
      mode: 0o755,
    });
    gitIn(repo, "config", "lfs.extension.x.clean", extension);
    gitIn(repo, "config", "lfs.extension.x.smudge", "cat");
    gitIn(repo, "config", "lfs.extension.x.priority", "0");
    const later = new Date(Date.now() + 5000);
    await utimes(join(repo, "big.bin"), later, later);
    await workingTree(repo).catch(() => undefined);
    await rm(extension, { force: true });
    expect(existsSync(marker)).toBe(false);
  },
);

it("keeps Git LFS's own commands and the user's global filters", async () => {
  const file = await gitExecutable();
  gitIn(repo, "config", "filter.lfs.process", "git-lfs filter-process");
  gitIn(repo, "config", "filter.lfs.clean", "git-lfs clean -- %f");
  gitIn(repo, "config", "filter.lfs.required", "true");
  expect(await filterOverride(file, repo, ["status"], gitEnv())).toEqual([]);
  configureFilter("x", "process");
  expect(
    await filterOverride(file, repo, ["commit", "-m", "x"], gitEnv()),
  ).toEqual([]);
});
