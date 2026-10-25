import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExecutable } from "../platform/executables";

/** A video a guest can play is at most this big; a longer one is dropped. */
export const MAX_GUEST_VIDEO_BYTES = 3 * 1024 * 1024;
/** Below this, a video squeezed into the limit isn't worth watching. */
const MIN_KBPS = 180;
const AUDIO_KBPS = 48;

/**
 * The video as a guest gets it: the file itself when it already fits in 3MB,
 * else a copy ffmpeg made to fit, kept in the temp folder. Undefined when it
 * can't fit at a watchable quality or there's no ffmpeg to make it fit.
 */
export async function guestVideo(path: string): Promise<string | undefined> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return undefined;
  if (info.size <= MAX_GUEST_VIDEO_BYTES) return path;
  const out = join(
    tmpdir(),
    "relay-guest-videos",
    `${createHash("sha256").update(`${path}:${info.mtimeMs}:${info.size}`).digest("hex").slice(0, 24)}.mp4`,
  );
  // Only a finished copy is ever at `out`; one being made is waited for.
  const made = await stat(out).catch(() => undefined);
  if (made?.isFile())
    return made.size <= MAX_GUEST_VIDEO_BYTES ? out : undefined;
  const making = pending.get(out);
  if (making) return making;
  const squeezing = squeeze(path, out).finally(() => pending.delete(out));
  pending.set(out, squeezing);
  return squeezing;
}

const pending = new Map<string, Promise<string | undefined>>();

async function squeeze(path: string, out: string) {
  const [ffmpeg, ffprobe] = await Promise.all([
    findExecutable("ffmpeg").catch(() => undefined),
    findExecutable("ffprobe").catch(() => undefined),
  ]);
  if (!ffmpeg || !ffprobe) return undefined;
  const seconds = Number(
    await run(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      path,
    ]),
  );
  if (!(seconds > 0)) return undefined;
  // 8% under the limit for the container and the encoder overshooting.
  const kbps = Math.floor((MAX_GUEST_VIDEO_BYTES * 8 * 0.92) / 1024 / seconds);
  if (kbps < MIN_KBPS) return undefined;
  const video = kbps - AUDIO_KBPS;
  await mkdir(join(tmpdir(), "relay-guest-videos"), { recursive: true });
  const part = `${out}.${process.pid}.part`;
  const encoded = await run(
    ffmpeg,
    [
      "-y",
      "-v",
      "error",
      "-i",
      path,
      "-vf",
      "scale='min(1280,iw)':-2,fps=30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-b:v",
      `${video}k`,
      "-maxrate",
      `${video}k`,
      "-bufsize",
      `${video * 2}k`,
      "-c:a",
      "aac",
      "-b:a",
      `${AUDIO_KBPS}k`,
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      part,
    ],
    10 * 60_000,
  ).then(
    () => true,
    () => false,
  );
  const made = encoded ? await stat(part).catch(() => undefined) : undefined;
  if (!made) {
    await rm(part, { force: true });
    return undefined;
  }
  // Kept even when too big, so the next guest isn't made to wait for it again.
  await rename(part, out);
  return made.size <= MAX_GUEST_VIDEO_BYTES ? out : undefined;
}

function run(program: string, args: string[], timeout = 15_000) {
  return new Promise<string>((resolve, reject) =>
    execFile(program, args, { timeout, windowsHide: true }, (error, stdout) =>
      error ? reject(error) : resolve(stdout.trim()),
    ),
  );
}
