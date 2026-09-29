import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { net } from "electron";
import type { DictationModelFile } from "../../shared/dictation";

const stallTimeout = 60_000;
const marker = "verified.json";

/** Whether every file finished downloading and matched its checksum. */
export async function modelComplete(dir: string, files: DictationModelFile[]) {
  try {
    const verified: string[] = JSON.parse(
      await readFile(join(dir, marker), "utf8"),
    );
    if (!files.every((file) => verified.includes(file.sha256))) return false;
    for (const file of files)
      if ((await stat(join(dir, file.name))).size !== file.size) return false;
    return true;
  } catch {
    return false;
  }
}

/** Bytes already on disk, finished or partial, for showing where a download stands. */
export async function modelReceived(dir: string, files: DictationModelFile[]) {
  let sum = 0;
  for (const file of files)
    for (const name of [file.name, `${file.name}.part`])
      sum += await stat(join(dir, name)).then(
        (s) => s.size,
        () => 0,
      );
  return Math.min(
    sum,
    files.reduce((total, file) => total + file.size, 0),
  );
}

/**
 * Downloads the files that are missing, picking up where an interrupted
 * download stopped, and checks each against its sha256.
 */
export async function downloadModel(
  dir: string,
  files: DictationModelFile[],
  signal: AbortSignal,
  progress: (received: number) => void,
) {
  await mkdir(dir, { recursive: true });
  let done = 0;
  for (const file of files) {
    const path = join(dir, file.name);
    const have = await stat(path).then(
      (s) => s.size,
      () => -1,
    );
    if (have !== file.size || (await sha256(path)) !== file.sha256)
      await fetchFile(file, path, signal, (received) =>
        progress(done + received),
      );
    done += file.size;
    progress(done);
  }
  await writeFile(
    join(dir, marker),
    JSON.stringify(files.map((file) => file.sha256)),
  );
}

async function fetchFile(
  file: DictationModelFile,
  path: string,
  signal: AbortSignal,
  progress: (received: number) => void,
) {
  const part = `${path}.part`;
  let start = await stat(part).then(
    (s) => s.size,
    () => 0,
  );
  if (start >= file.size) start = 0;
  const stalled = new AbortController();
  let idle = setTimeout(() => stalled.abort(), stallTimeout);
  const hash = createHash("sha256");
  try {
    const response = await net.fetch(file.url, {
      cache: "no-store",
      signal: AbortSignal.any([signal, stalled.signal]),
      headers: start ? { Range: `bytes=${start}-` } : {},
    });
    if (!response.ok || !response.body)
      throw new Error(`The download answered ${response.status}.`);
    // A server that ignores the range sends the whole file again.
    if (response.status !== 206) start = 0;
    else
      for await (const chunk of createReadStream(part, { end: start - 1 }))
        hash.update(chunk);
    await write(response.body, part, start, hash, progress, () => {
      clearTimeout(idle);
      idle = setTimeout(() => stalled.abort(), stallTimeout);
    });
  } catch (error) {
    if (stalled.signal.aborted)
      throw new Error("The download stalled. Try again.");
    throw error;
  } finally {
    clearTimeout(idle);
  }
  const digest = hash.digest("hex");
  if (digest !== file.sha256) {
    // Start over next time rather than resuming a corrupt file.
    await writeFile(part, "");
    throw new Error(
      "The download didn't match the model's checksum. Try again.",
    );
  }
  await rename(part, path);
}

async function write(
  body: ReadableStream<Uint8Array>,
  part: string,
  start: number,
  hash: ReturnType<typeof createHash>,
  progress: (received: number) => void,
  alive: () => void,
) {
  let received = start;
  await pipeline(
    async function* () {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          alive();
          hash.update(value);
          received += value.byteLength;
          progress(received);
          yield value;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    },
    createWriteStream(part, { flags: start ? "a" : "w", mode: 0o600 }),
  );
}

function sha256(path: string) {
  const hash = createHash("sha256");
  return pipeline(createReadStream(path), hash).then(
    () => hash.digest("hex"),
    () => "",
  );
}
