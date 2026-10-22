import { execFileSync } from "node:child_process";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Runs git in `dir`; its output, trimmed. Throws with git's stderr on failure. */
export const gitIn = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

/** Makes `dir` a repository on `main` with a committer, so tests can commit. */
export function initRepo(dir: string) {
  execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: "pipe" });
  gitIn(dir, "config", "user.name", "Test");
  gitIn(dir, "config", "user.email", "test@example.invalid");
}

/** A fresh repository in a temp folder, by its real path (macOS links /var to /private/var). */
export async function tempRepo(prefix = "relay-repo-") {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  initRepo(dir);
  return dir;
}
