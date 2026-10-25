import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { pasteFileName } from "../../shared/pasted-texts";

/** A paste untouched this long, and named by no saved thread or draft, goes. */
const keepMs = 30 * 24 * 60 * 60 * 1000;

let root: string | undefined;

/** Where pastes too big for a message are kept: Relay's own data folder, set as the app starts. */
export function setPastesRoot(dir: string) {
  root = dir;
}

/** The folder agents may read pastes from without asking; unset until Relay has started. */
export const pastesRoot = () => root;

// A paste, or a file a phone attached, each in a folder of its own.
const pasteRelative = /^[0-9a-f-]{36}[\\/][^\\/]+$/;

/** The file at `path` if Relay saved it among its pastes; null for any other path, or one that's gone. */
async function savedPaste(path: string, at: string | undefined) {
  if (!at || !pasteRelative.test(relative(at, path))) return null;
  let real: string;
  try {
    real = await realpath(path);
  } catch (e) {
    // Deleted, or never copied here: the message keeps naming it as it was.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  if (!pasteRelative.test(relative(await realpath(at), real)))
    throw new Error("The paste points outside Relay's paste folder.");
  return real;
}

/** The size of a file Relay saved among its pastes; null as `readPaste` gives. */
export async function pasteSize(path: string, at = root) {
  const real = await savedPaste(path, at);
  return real === null ? null : (await stat(real)).size;
}

/** Only files Relay saved as pastes may cross to a paired computer. */
export async function readPaste(
  path: string,
  offset: number,
  size: number,
  at = root,
) {
  if ((await savedPaste(path, at)) === null) return null;
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

const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";

/** The files in `places` that can name a paste: each file itself, or the `.json` files directly in a folder. */
async function savedFiles(places: string[]) {
  const files: string[] = [];
  for (const place of places) {
    const names = await readdir(place).catch((e) => {
      if (missing(e)) return null;
      if ((e as NodeJS.ErrnoException).code === "ENOTDIR") return undefined;
      throw e;
    });
    if (names === undefined) files.push(place);
    else
      for (const name of names ?? [])
        if (name.endsWith(".json")) files.push(join(place, name));
  }
  return files;
}

/**
 * Drops pastes nobody touched in a month that no saved thread, draft or
 * queued send still names; a thread resumed later would point at a file that's
 * gone. Any file it can't read stops the sweep rather than risk a paste in use.
 */
export async function sweepPastes(places: string[], now = Date.now()) {
  if (!root) return;
  const names = await readdir(root).catch((e) => {
    if (missing(e)) return [];
    throw e;
  });
  const old = new Set<string>();
  for (const name of names)
    if (now - (await stat(join(root, name))).mtimeMs > keepMs) old.add(name);
  if (!old.size) return;
  for (const file of await savedFiles(places)) {
    const text = await readFile(file, "utf8").catch((e) => {
      if (missing(e)) return "";
      throw e;
    });
    for (const name of old) if (text.includes(name)) old.delete(name);
    if (!old.size) return;
  }
  for (const name of old)
    await rm(join(root, name), { recursive: true, force: true });
}
