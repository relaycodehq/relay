import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import { errorMessage } from "../../shared/error-message";

export async function gunzipTo(archive: string, file: string) {
  await mkdir(dirname(file), { recursive: true });
  await pipeline(
    createReadStream(archive),
    createGunzip(),
    createWriteStream(file),
  );
}

/**
 * An entry's path inside the archive with `strip` folders dropped; undefined
 * when nothing is left. Throws for one that would land outside the folder.
 */
export function zipEntryPath(name: string, strip: number) {
  if (/^([A-Za-z]:|[\\/])/.test(name) || name.includes("\\"))
    throw new Error(`The archive has an unsafe path: ${name}`);
  const parts = name.split("/").filter((p) => p && p !== ".");
  if (parts.includes(".."))
    throw new Error(`The archive has an unsafe path: ${name}`);
  const kept = parts.slice(strip);
  return kept.length ? kept.join("/") : undefined;
}

/** How much unpacked data may wait for the disk before reading the archive pauses. */
const UNPACK_BACKLOG_BYTES = 32 * 1024 * 1024;

/** Unpacks a zip into `dest` without holding it in memory. */
export async function unzipTo(archive: string, dest: string, strip = 0) {
  const outputs: Promise<void>[] = [];
  let failure: Error | undefined;
  let backlog = 0;
  let waitFor: Promise<void> | undefined;
  const unzip = new Unzip((entry) => {
    if (failure || entry.name.endsWith("/")) return;
    let rel: string | undefined;
    try {
      rel = zipEntryPath(entry.name, strip);
    } catch (e) {
      failure = e as Error;
      return;
    }
    if (rel === undefined) return;
    const path = join(dest, ...rel.split("/"));
    let out!: WriteStream;
    // Chunks queue behind the folder being made and the writes before them.
    let queue = mkdir(dirname(path), { recursive: true }).then(() => {
      out = createWriteStream(path);
      out.on("error", (e) => (failure ??= e));
    });
    entry.ondata = (err, data, final) => {
      if (err) {
        failure ??= err;
        return;
      }
      const chunk = Buffer.from(data);
      backlog += chunk.length;
      queue = queue.then(async () => {
        if (chunk.length && !out.write(chunk)) await once(out, "drain");
        backlog -= chunk.length;
        if (final) await new Promise<void>((resolve) => out.end(resolve));
      });
      queue.catch((e) => (failure ??= e));
      if (final) outputs.push(queue);
      if (backlog > UNPACK_BACKLOG_BYTES) waitFor = queue;
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  try {
    for await (const chunk of createReadStream(archive, {
      highWaterMark: 1 << 20,
    })) {
      unzip.push(chunk as Buffer);
      if (failure) throw failure;
      if (waitFor) {
        await waitFor;
        waitFor = undefined;
      }
    }
    unzip.push(new Uint8Array(0), true);
    await Promise.all(outputs);
    if (failure) throw failure;
  } catch (e) {
    throw new Error(`Could not unpack the download: ${errorMessage(e)}`);
  }
}
