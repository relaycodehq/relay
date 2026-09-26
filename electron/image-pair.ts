import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { extname } from "node:path";
import { git, gitBytes } from "./git";
import { safeWorkingPath } from "./working-files";
import type { FilePair } from "../shared/types";
const types: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
/** Larger images stay a placeholder rather than crossing IPC as base64. */
export const imageLimit = 10 * 1024 * 1024;
/** One side of a diff: a git object, or the file on disk. */
export type FileSource = { name: string } & ({ spec: string } | { disk: true });
class TooLarge extends Error {}
async function fromGit(root: string, spec: string): Promise<Buffer | null> {
  const size = await git(root, ["cat-file", "-s", spec]).then(
    (stdout) => Number(stdout.trim()),
    () => null,
  );
  if (size === null) return null;
  if (size > imageLimit) throw new TooLarge();
  return gitBytes(root, ["cat-file", "blob", spec], imageLimit);
}
async function fromDisk(root: string, path: string): Promise<Buffer | null> {
  const full = await safeWorkingPath(root, path);
  const handle = await open(
    full,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
  if (!handle) return null;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) return null;
    if (stat.size > imageLimit) throw new TooLarge();
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
/**
 * Both sides of a binary change as data URLs, when the file is an image the
 * renderer can show. Absent sides are null; anything unreadable or too big
 * leaves the whole pair a placeholder.
 */
export async function imageSides(
  root: string,
  old: FileSource | null,
  next: FileSource | null,
): Promise<FilePair["images"]> {
  const sides = [old, next];
  if (!sides.some((s) => s && types[extname(s.name).toLowerCase()]))
    return undefined;
  try {
    const [before, after] = await Promise.all(
      sides.map(async (s) => {
        const type = s && types[extname(s.name).toLowerCase()];
        if (!s || !type) return null;
        const bytes =
          "spec" in s
            ? await fromGit(root, s.spec)
            : await fromDisk(root, s.name);
        return bytes && `data:${type};base64,${bytes.toString("base64")}`;
      }),
    );
    return { old: before, next: after };
  } catch {
    return undefined;
  }
}
