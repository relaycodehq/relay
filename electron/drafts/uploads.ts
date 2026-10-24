import { mkdir, open, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { maxUploadBytes, type UploadedFile } from "../../shared/remote";
import { pastesRoot } from "./pastes";

const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";

/**
 * The phone's name for a file, safe as one on every desktop: no folders, no
 * characters Windows refuses, not hidden, and short enough for any disk.
 */
export function uploadName(name: string) {
  const clean = name
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (!clean) return "attachment";
  if (clean.length <= 120) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : "";
  return clean.slice(0, 120 - ext.length) + ext;
}

// A retry may arrive while the call it repeats is still writing.
const writing = new Map<string, Promise<unknown>>();

/**
 * A phone's file arrives in chunks into a folder of its own among the pastes,
 * so agents may read it and the paste sweep clears it once nothing names it.
 * It's written beside its name until whole, so a path a message names is
 * always the complete file. Any chunk may come twice or after a failure: one
 * the computer has is skipped, one past what it has is ignored, and the
 * answer says where to carry on.
 */
export function writeUploadChunk(
  id: string,
  name: string,
  size: number,
  offset: number,
  bytes: Buffer,
  at = pastesRoot(),
): Promise<UploadedFile> {
  if (size > maxUploadBytes)
    return Promise.reject(new Error("This file is too large."));
  return queued(at, id, () => writeChunk(id, name, offset, bytes, at, size));
}

/**
 * A file a paired computer's thread names, fetched in chunks of a size only
 * its last one falls short of; written as a phone's would be.
 */
export function receiveFileChunk(
  id: string,
  name: string,
  offset: number,
  bytes: Buffer,
  last: boolean,
  at = pastesRoot(),
): Promise<UploadedFile> {
  return queued(at, id, () =>
    writeChunk(id, name, offset, bytes, at, last ? offset + bytes.length : null),
  );
}

function queued<T>(at: string | undefined, id: string, write: () => Promise<T>) {
  const key = `${at}\0${id}`;
  const next = (writing.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(write);
  writing.set(key, next);
  void next
    .finally(() => {
      if (writing.get(key) === next) writing.delete(key);
    })
    .catch(() => {});
  return next;
}

/** `size` is the whole file's, when known; the file is named once that much is here. */
async function writeChunk(
  id: string,
  name: string,
  offset: number,
  bytes: Buffer,
  at: string | undefined,
  size: number | null,
): Promise<UploadedFile> {
  if (!at) throw new Error("Relay is still starting.");
  if (offset + bytes.length > (size ?? maxUploadBytes))
    throw new Error(
      size === null
        ? "This file is too large."
        : "The upload is longer than its file.",
    );
  const dir = join(at, id);
  const path = join(dir, uploadName(name));
  const partial = `${path}.part`;
  const done = await stat(path).catch((e) => {
    if (missing(e)) return null;
    throw e;
  });
  if (done) {
    if (size !== null && done.size !== size)
      throw new Error("A different file has this id.");
    return { received: done.size, path };
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const handle = await open(partial, "a", 0o600);
  let received: number;
  try {
    received = (await handle.stat()).size;
    if (offset <= received && offset + bytes.length > received) {
      await handle.write(bytes, received - offset);
      received = offset + bytes.length;
    }
  } finally {
    await handle.close();
  }
  if (size === null || received < size) return { received };
  await rename(partial, path);
  return { received, path };
}
