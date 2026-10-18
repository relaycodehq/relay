import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pasteFileName } from "../../shared/pasted-texts";

let root: string | undefined;
/** Where pastes too big for a message are kept: Relay's own data folder, set as the app starts. */
export function setPastesRoot(dir: string) {
  root = dir;
}

/** The folder agents may read pastes from without asking; unset until Relay has started. */
export const pastesRoot = () => root;

const pasteRelative = /^[0-9a-f-]{36}[\\/]pasted-text(?:-[1-9]\d{0,2})?\.txt$/;
/** Only files Relay saved as pastes may cross to a paired computer. */
export async function readPaste(
  path: string,
  offset: number,
  size: number,
  at = root,
) {
  if (!at || !pasteRelative.test(relative(at, path))) return null;
  if (!pasteRelative.test(relative(await realpath(at), await realpath(path))))
    throw new Error("The paste points outside Relay's paste folder.");
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, offset);
    return buffer.subarray(0, bytesRead).toString("base64");
  } finally {
    await handle.close();
  }
}

/** A paste arrives in bounded chunks, without putting its contents in a bridge frame. */
export async function writePasteChunk(
  id: string,
  n: number,
  offset: number,
  bytes: Buffer,
  at = root,
) {
  if (!at) throw new Error("Relay is still starting.");
  // savePaste accepts up to 50 million UTF-16 characters.
  if (offset + bytes.length > 200 * 1024 * 1024)
    throw new Error("This paste is too large.");
  const dir = join(at, id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, pasteFileName(n));
  if (offset === 0) await writeFile(path, bytes, { mode: 0o600 });
  else {
    const size = (await stat(path)).size;
    if (offset + bytes.length > size) {
      if (offset !== size)
        throw new Error(
          `The paste upload is out of step: expected byte ${size}.`,
        );
      const handle = await open(path, "a");
      try {
        await handle.write(bytes);
      } finally {
        await handle.close();
      }
    }
  }
  return path;
}

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
