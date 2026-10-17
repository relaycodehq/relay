import { lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { videoMime } from "../../shared/project-files";
import type { FilePair } from "../../shared/types";
import { mediaUrl } from "../media";
import { git, gitBytes } from "./git";
import type { FileSource } from "./image-pair";
import { safeWorkingPath } from "./working-files";

/** A committed side has to be copied out of git to be played; bigger ones stay a placeholder. */
const blobLimit = 200 * 1024 * 1024;
const blobs = join(tmpdir(), "relay-media-blobs");

class TooLarge extends Error {}

/** A committed video as a file, kept by its object id so each version is copied once. */
async function fromGit(root: string, spec: string, ext: string) {
  const sha = await git(root, ["rev-parse", "--verify", "--quiet", spec]).then(
    (stdout) => stdout.trim(),
    () => "",
  );
  if (!sha) return null;
  const file = join(blobs, sha + ext);
  if (await lstat(file).then((s) => s.isFile(), () => false)) return file;
  const size = Number(await git(root, ["cat-file", "-s", sha]));
  if (size > blobLimit) throw new TooLarge();
  const bytes = await gitBytes(root, ["cat-file", "blob", sha], blobLimit);
  await mkdir(blobs, { recursive: true });
  const partial = `${file}.${process.pid}.part`;
  await writeFile(partial, bytes);
  await rename(partial, file);
  return file;
}

async function fromDisk(root: string, path: string) {
  const full = await safeWorkingPath(root, path);
  const stat = await lstat(full).catch(() => null);
  return stat?.isFile() && stat.nlink === 1 ? full : null;
}

/**
 * Both sides of a binary change as addresses the renderer can play, when the
 * file is a video. Absent sides are null; anything unreadable or too big
 * leaves the whole pair a placeholder.
 */
export async function videoSides(
  root: string,
  old: FileSource | null,
  next: FileSource | null,
): Promise<FilePair["videos"]> {
  if (![old, next].some((s) => s && videoMime(s.name))) return undefined;
  try {
    const [before, after] = await Promise.all(
      [old, next].map(async (s) => {
        if (!s || !videoMime(s.name)) return null;
        const full =
          "spec" in s
            ? await fromGit(root, s.spec, extname(s.name).toLowerCase())
            : await fromDisk(root, s.name);
        return full && mediaUrl(full);
      }),
    );
    return { old: before, next: after };
  } catch {
    return undefined;
  }
}
