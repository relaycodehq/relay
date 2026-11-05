import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setGitPath } from "../../electron/git/git";

/**
 * Runs `read` with Relay's Git counting its runs; returns each run's
 * subcommand, the first argument that isn't `-C dir` or `-c key=value`.
 */
export async function gitRuns(read: () => Promise<unknown>) {
  const dir = await mkdtemp(join(tmpdir(), "relay-git-runs-"));
  const log = join(dir, "runs.log");
  const shim = join(dir, "git");
  const real = execFileSync("sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).trim();
  await writeFile(log, "");
  await writeFile(
    shim,
    `#!/bin/sh\nfor a in "$@"; do case "$prev" in -C|-c) prev=;; *) case "$a" in -C|-c) prev=$a;; *) echo "$a" >> '${log}'; break;; esac;; esac; done\nexec '${real}' "$@"\n`,
  );
  await chmod(shim, 0o755);
  setGitPath(shim);
  try {
    await read();
  } finally {
    setGitPath(null);
  }
  // Finding the shim asks its version once; that's not the reading counted.
  const runs = (await readFile(log, "utf8"))
    .split("\n")
    .filter((run) => run && run !== "--version");
  await rm(dir, { recursive: true, force: true });
  return runs;
}
