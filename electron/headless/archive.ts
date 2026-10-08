import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Windows' own bsdtar: a GNU tar from Git for Windows earlier on PATH reads
 * `C:` as a remote host.
 */
function tar() {
  if (process.platform !== "win32") return "tar";
  const own = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "tar.exe",
  );
  return existsSync(own) ? own : "tar";
}

/** Unpacks a .tar.gz into `dest`, only `members` when given. */
export async function extract(
  archive: string,
  dest: string,
  members: string[] = [],
) {
  await run(tar(), ["-xzf", archive, "-C", dest, ...members], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * Downloads `url` to `file`, checking it against `digest`: npm's
 * `sha512-<base64>` integrity or a bare base64 SHA-512. A file that doesn't
 * match is deleted and the download fails.
 */
export async function download(
  url: string,
  file: string,
  digest: string,
  options: {
    fetch?: typeof fetch;
    size?: number;
    progress?: (received: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
) {
  const response = await (options.fetch ?? fetch)(url, {
    signal: options.signal ?? AbortSignal.timeout(30 * 60_000),
  });
  if (!response.ok || !response.body)
    throw new Error(`${url} answered ${response.status}.`);
  const total =
    options.size ?? Number(response.headers.get("content-length") ?? 0);
  const hash = createHash("sha512");
  let received = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream),
      new Transform({
        transform: (chunk: Buffer, _encoding, done) => {
          hash.update(chunk);
          received += chunk.length;
          options.progress?.(received, total);
          done(null, chunk);
        },
      }),
      createWriteStream(file),
    );
    const want = digest.replace(/^sha512-/, "");
    if (hash.digest("base64") !== want)
      throw new Error(`${url} doesn't match the release; nothing changed.`);
  } catch (e) {
    await rm(file, { force: true });
    throw e;
  }
  return received;
}

/**
 * Renames, trying again for a few seconds where Windows holds a folder a
 * moment longer (an antivirus scan, an indexer).
 */
export async function renameSoon(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (
        attempt >= 20 ||
        (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")
      )
        throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
