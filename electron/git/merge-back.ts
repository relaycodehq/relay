import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitBytes } from "./git";
import { textLimit } from "./working-files";

/** A blob as it would be checked out, line endings and filters applied. */
async function checkedOut(root: string, rev: string, path: string) {
  // Filters such as LFS may reach the network; gitEnv keeps them from prompting.
  return gitBytes(root, ["cat-file", "--filters", `${rev}:${path}`]);
}

/** Undoes `from` → `to` on top of whatever the file holds now; null when it conflicts. */
export async function mergeBack(
  root: string,
  path: string,
  from: string,
  to: string,
  sameText: boolean,
) {
  // Only its mode moved: the text stays as it is now.
  if (sameText) return readFile(join(root, path));
  const dir = await mkdtemp(join(tmpdir(), "relay-rewind-"));
  try {
    const base = join(dir, "base");
    const other = join(dir, "other");
    await writeFile(base, await checkedOut(root, from, path));
    await writeFile(other, await checkedOut(root, to, path));
    // Exits non-zero on conflicts and refuses binary files: both stay as they are.
    return await gitBytes(
      root,
      ["merge-file", "-p", "-q", join(root, path), base, other],
      textLimit * 2,
    );
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
