import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { digest } from "./working-tree";
import { workingPathSchema } from "../shared/working-tree";
export const textLimit = 2 * 1024 * 1024;
export interface WorkingFile {
  contents: string;
  hash: string;
  mode: number;
}
export function decodeText(bytes: Buffer): string {
  if (bytes.length > textLimit)
    throw new Error("Text files larger than 2 MiB are not supported here.");
  if (bytes.includes(0))
    throw new Error("Binary files are not supported here.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error(
      "This file is not valid UTF-8. Edit it in your IDE to preserve its encoding.",
    );
  }
  if (text.startsWith("version https://git-lfs.github.com/spec/v1"))
    throw new Error("Git LFS files must be edited in your IDE.");
  return text;
}
export async function safeWorkingPath(
  root: string,
  path: string,
  createParents = false,
): Promise<string> {
  workingPathSchema.parse(path);
  if ((await realpath(root)) !== root)
    throw new Error("The checkout path changed. Relink it first.");
  let full = root;
  const parts = path.split("/");
  for (const [i, part] of parts.entries()) {
    full = join(full, part);
    let entry = await lstat(full).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (!entry && i < parts.length - 1 && createParents) {
      await mkdir(full, { mode: 0o755 }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "EEXIST") throw e;
      });
      entry = await lstat(full);
    }
    if (!entry) continue;
    if (entry.isSymbolicLink())
      throw new Error("Symbolic links cannot be edited or synchronized.");
    if (i < parts.length - 1 ? !entry.isDirectory() : !entry.isFile())
      throw new Error("Choose a regular file in the linked checkout.");
    if (i === parts.length - 1 && entry.nlink !== 1)
      throw new Error("Hard-linked files cannot be edited or synchronized.");
  }
  return full;
}
export async function readWorkingFile(
  root: string,
  path: string,
): Promise<WorkingFile | null> {
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
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error("Choose a regular, unlinked file.");
    if (stat.size > textLimit)
      throw new Error("Text files larger than 2 MiB are not supported here.");
    const bytes = Buffer.alloc(textLimit + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    const value = bytes.subarray(0, length);
    return {
      contents: decodeText(value),
      hash: digest(value),
      mode: stat.mode & 0o777,
    };
  } finally {
    await handle.close();
  }
}
const saves = new Map<string, Promise<unknown>>();
export async function flushWorkingFiles() {
  await Promise.allSettled([...saves.values()]);
}
export async function writeWorkingFile(
  root: string,
  path: string,
  expected: string | null,
  value: { contents: string; mode?: number } | null,
  validate?: () => Promise<unknown>,
) {
  const key = join(root, path),
    before = saves.get(key);
  const task = (async () => {
    await before?.catch(() => {});
    await validate?.();
    root = await realpath(root);
    const current = await readWorkingFile(root, path);
    const check = (file: WorkingFile | null) => {
      if ((file?.hash ?? null) !== expected)
        throw new Error(
          "This file changed on disk since you opened or saved it. Your edits are still here. Reload the disk version before saving.",
        );
    };
    check(current);
    if (current && !(current.mode & 0o222))
      throw new Error("This file is read-only.");
    if (value) decodeText(Buffer.from(value.contents, "utf8"));
    const full = await safeWorkingPath(root, path, !!value);
    if (!value) {
      await validate?.();
      check(await readWorkingFile(root, path));
      if (current) await unlink(full);
      return;
    }
    // Same-directory rename is atomic. The sync scanner excludes these temporary files.
    const temp = join(dirname(full), `.relay-sync-${randomUUID()}.tmp`);
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(value.contents, "utf8");
      await handle.chmod(value.mode ?? current?.mode ?? 0o644);
      await handle.sync();
      await handle.close();
      await validate?.();
      await safeWorkingPath(root, path);
      check(await readWorkingFile(root, path));
      await rename(temp, full);
    } finally {
      await handle.close().catch(() => {});
      await unlink(temp).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
  })();
  saves.set(key, task);
  try {
    await task;
  } finally {
    if (saves.get(key) === task) saves.delete(key);
  }
}
