import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, rename, rm, utimes } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extname, join } from "node:path";
import { app } from "electron";
import { videoMime } from "../../shared/project-files";
import type { FilePair } from "../../shared/types";
import { mediaUrl } from "../media";
import { git, gitEnv, gitError, gitExecutable } from "./git";
import { stopProcessTree } from "../platform/terminate";
import type { FileSource } from "./image-pair";
import { safeWorkingPath } from "./working-files";

/** A committed side has to be copied out of git to be played; bigger ones stay a placeholder. */
const blobLimit = 200 * 1024 * 1024;
/** Copies kept past this go, least recently shown first. */
const cacheLimit = 1024 * 1024 * 1024;
/** A partial copy this old was left by a Relay that quit while writing it. */
const staleMs = 60 * 60 * 1000;

// Relay's own folder, not the shared temp one where anyone could leave a file by the name of a blob.
const blobs = () => join(app.getPath("userData"), "cache", "video-blobs");

class TooLarge extends Error {}

/** Copies being written, by file: both sides of a renamed video are the same blob. */
const copying = new Map<string, Promise<string>>();

/** A committed video as a file, kept by its object id so each version is copied once. */
async function fromGit(root: string, spec: string, ext: string) {
  const sha = await git(root, ["rev-parse", "--verify", "--quiet", spec]).then(
    (stdout) => stdout.trim(),
    () => "",
  );
  if (!sha) return null;
  const dir = blobs();
  const file = join(dir, sha + ext);
  if ((await lstat(file).catch(() => null))?.isFile()) {
    const now = new Date();
    await utimes(file, now, now).catch(() => {});
    return file;
  }
  let copy = copying.get(file);
  if (!copy) {
    copy = copyBlob(root, sha, dir, file).finally(() => copying.delete(file));
    copying.set(file, copy);
  }
  return copy;
}

async function copyBlob(root: string, sha: string, dir: string, file: string) {
  const size = Number(await git(root, ["cat-file", "-s", sha]));
  if (!Number.isSafeInteger(size) || size < 0 || size > blobLimit)
    throw new TooLarge();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const partial = `${file}.${randomUUID()}.part`;
  try {
    await streamBlob(root, sha, partial, size);
    await rename(partial, file);
  } finally {
    await rm(partial, { force: true }).catch(() => {});
  }
  void prune(dir, file).catch((e) =>
    console.warn("Could not trim the video cache:", e),
  );
  return file;
}

/** Backpressure keeps even two large video sides to a handful of stream buffers. */
async function streamBlob(
  root: string,
  sha: string,
  partial: string,
  size: number,
) {
  const child = spawn(
    await gitExecutable(),
    ["-C", root, "cat-file", "blob", sha],
    {
      env: gitEnv(),
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let failure: unknown;
  let stopping: Promise<void> | undefined;
  const stop = (error: unknown) => {
    failure ??= error;
    stopping ??= stopProcessTree(child).catch((error) => {
      failure = error;
    });
  };
  let copied = 0,
    stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 16_384)
      stderr += chunk.toString().slice(0, 16_384 - stderr.length);
  });
  child.once("error", (error) => {
    failure ??= error;
  });
  const exited = new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  );
  const timer = setTimeout(() => stop(new Error("Git timed out.")), 15_000);
  try {
    const transfer = pipeline(
      child.stdout,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          copied += chunk.length;
          done(copied > blobLimit ? new TooLarge() : null, chunk);
        },
      }),
      createWriteStream(partial, { flags: "wx", mode: 0o600 }),
    ).catch(stop);
    const [, code] = await Promise.all([transfer, exited]);
    await stopping;
    if (failure) throw gitError(failure);
    if (code !== 0)
      throw gitError({ message: `Git exited with ${code}.`, stderr });
    if (copied !== size)
      throw new Error("Git returned an incomplete video blob.");
  } finally {
    clearTimeout(timer);
  }
}

/** Trims the cache to its limit, keeping `kept`, which was just copied. */
async function prune(dir: string, kept: string) {
  const now = Date.now();
  const entries = await Promise.all(
    (await readdir(dir)).map(async (name) => {
      const path = join(dir, name);
      const stat = await lstat(path).catch(() => null);
      return stat?.isFile()
        ? { path, size: stat.size, at: stat.mtimeMs }
        : null;
    }),
  );
  const files = entries.filter((e) => e !== null);
  let total = files.reduce((sum, f) => sum + f.size, 0);
  for (const f of files.sort((a, b) => a.at - b.at)) {
    if (total <= cacheLimit) break;
    if (f.path === kept) continue;
    // Another copy may still be writing this one.
    if (f.path.endsWith(".part") && now - f.at < staleMs) continue;
    await rm(f.path, { force: true });
    total -= f.size;
  }
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
        return full && mediaUrl(full, "spec" in s ? blobs() : root);
      }),
    );
    return { old: before, next: after };
  } catch {
    return undefined;
  }
}
