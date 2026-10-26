import { realpath } from "node:fs/promises";
import { join } from "node:path";

/**
 * The key a file's versions are kept under: its real path, so the same file
 * reached through a link or a worktree-relative path shares one history.
 * `root` is the folder the file's path is relative to.
 */
export async function historyKey(root: string, path: string) {
  const full = join(await realpath(root), path);
  return realpath(full).catch(() => full);
}
