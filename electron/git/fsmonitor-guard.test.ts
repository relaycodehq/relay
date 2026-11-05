import { afterEach, beforeEach, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitIn, tempRepo } from "../../tests/fixtures/git-repo";
import { checkMonitor, monitorOverride } from "./fsmonitor-guard";
import { gitEnv, gitExecutable } from "./git";
import { workingTree } from "./working-tree";

let repo: string;
let marker: string;

beforeEach(async () => {
  repo = await tempRepo("relay-fsmonitor-");
  marker = join(repo, "..", `${repo.split("/").pop()}-hook-ran`);
  await writeFile(join(repo, "a.txt"), "a\n");
  gitIn(repo, "add", ".");
  gitIn(repo, "commit", "-qm", "init");
  // A folder handed over whole brings its own .git/config, hook and all.
  const hook = join(repo, ".git", "fsmonitor-hook.sh");
  await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
  await chmod(hook, 0o755);
  gitIn(repo, "config", "core.fsmonitor", hook);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(marker, { force: true });
});

it.skipIf(process.platform === "win32")(
  "polls a repository without running the fsmonitor hook its config names",
  async () => {
    await workingTree(repo);
    await checkMonitor(await gitExecutable(), repo, gitEnv());
    await writeFile(join(repo, "a.txt"), "changed\n");
    expect((await workingTree(repo)).changes.map((c) => c.path)).toEqual([
      "a.txt",
    ]);
    expect(existsSync(marker)).toBe(false);
  },
);

it("keeps the repository's own fsmonitor for a commit, and Git's builtin one for reads", async () => {
  const file = await gitExecutable();
  await checkMonitor(file, repo, gitEnv());
  expect(monitorOverride(file, repo, ["commit", "-m", "x"], gitEnv())).toEqual(
    [],
  );
  const builtin = await tempRepo("relay-fsmonitor-builtin-");
  try {
    gitIn(builtin, "config", "core.fsmonitor", "true");
    await checkMonitor(file, builtin, gitEnv());
    expect(monitorOverride(file, builtin, ["status"], gitEnv())).toEqual([]);
  } finally {
    await rm(builtin, { recursive: true, force: true });
  }
});
