import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pasteFileName } from "../../shared/pasted-texts";

/** A paste nobody reopened in a month goes; a thread resumed later than that names a file that's gone. */
const keepMs = 30 * 24 * 60 * 60 * 1000;

let root: string | undefined;
/** Where pastes too big for a message are kept: Relay's own data folder, set as the app starts. */
export function setPastesRoot(dir: string) {
  root = dir;
}

/** The folder agents may read pastes from without asking; unset until Relay has started. */
export const pastesRoot = () => root;

/**
 * Saves a paste as a file in a folder of its own, so its name stays
 * `pasted-text.txt` (or `-n` for the message's nth); the path the message
 * names in its place. Only the user can read it: pastes are often logs with
 * tokens in them.
 */
export async function savePaste(text: string, n: number) {
  if (!root) throw new Error("Relay is still starting.");
  const dir = join(root, randomUUID());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, pasteFileName(n));
  await writeFile(path, text, { mode: 0o600 });
  return path;
}

/** Drops the pastes saved over a month ago. */
export async function sweepPastes(now = Date.now()) {
  if (!root) return;
  const dirs = await readdir(root).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  for (const name of dirs) {
    const dir = join(root, name);
    const { mtimeMs } = await stat(dir);
    if (now - mtimeMs > keepMs) await rm(dir, { recursive: true, force: true });
  }
}
