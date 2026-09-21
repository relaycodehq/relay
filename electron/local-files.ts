import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { LocalFile, PullRef } from "../shared/types";
import { filePathSchema, shaSchema } from "../shared/validation";
import { inspectFolder } from "./repository";

const exec = promisify(execFile);
const limit = 2 * 1024 * 1024;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const saves = new Map<string, Promise<unknown>>();
export async function flushLocalFiles() {
  await Promise.allSettled([...saves.values()]);
}

function decode(bytes: Buffer) {
  if (bytes.length > limit)
    throw new Error("Local editing is limited to text files up to 2 MiB.");
  if (bytes.includes(0))
    throw new Error("This is a binary file and cannot be edited here.");
  let text: string;
  try {
    // Preserve a UTF-8 BOM rather than stripping it from the saved file.
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

async function safePath(root: string, path: string) {
  filePathSchema.parse(path);
  const parts = path.split("/");
  if (
    path.includes("\\") ||
    parts.some((part) => !part || part.toLowerCase() === ".git")
  )
    throw new Error("This path cannot be edited.");
  let full = root;
  for (const [index, part] of parts.entries()) {
    full = join(full, part);
    const entry = await lstat(full);
    if (entry.isSymbolicLink())
      throw new Error(
        "Symbolic links cannot be edited here. Open the file in your IDE.",
      );
    if (index < parts.length - 1 ? !entry.isDirectory() : !entry.isFile())
      throw new Error("Choose a regular file in the linked checkout.");
    if (index === parts.length - 1 && entry.nlink !== 1)
      throw new Error(
        "Hard-linked files cannot be edited here. Open the file in your IDE.",
      );
  }
  if ((await realpath(full)) !== full)
    throw new Error("The file path changed. Reopen the editor.");
  return full;
}

async function readBytes(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error("Choose a regular, unlinked file.");
    if (stat.size > limit)
      throw new Error("Local editing is limited to text files up to 2 MiB.");
    const bytes = Buffer.alloc(limit + 1);
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
    const contents = bytes.subarray(0, length);
    decode(contents);
    return {
      bytes: contents,
      mode: stat.mode & 0o777,
      version: hash(contents),
    };
  } finally {
    await handle.close();
  }
}

async function validate(
  root: string,
  server: string,
  ref: PullRef,
  head: string,
  path: string,
) {
  shaSchema.parse(head);
  const local = await inspectFolder(root, server, ref);
  if (!local.remoteMatches)
    throw new Error(
      "The linked folder’s remote no longer matches this repository. Relink the correct folder.",
    );
  if (local.head !== head)
    throw new Error(
      "Your checkout is on a different commit. Check out this PR’s head before editing. Your local files have not been changed.",
    );
  const full = await safePath(local.path, path);
  const git = async (...args: string[]) =>
    (
      await exec("git", ["-C", local.path, ...args], {
        timeout: 10000,
        maxBuffer: limit + 4096,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_LITERAL_PATHSPECS: "1",
        },
        encoding: "buffer",
      })
    ).stdout;
  const tree = (await git("ls-tree", "-z", head, "--", path)).toString("utf8");
  if (
    !/^100(644|755) blob [a-f0-9]+\t/.test(tree) ||
    tree.slice(tree.indexOf("\t") + 1) !== `${path}\0`
  )
    throw new Error(
      "This file is not a regular file in the PR head. Deleted files and submodules cannot be edited here.",
    );
  return { full, local, git };
}

export async function readLocalFile(
  root: string,
  server: string,
  ref: PullRef,
  head: string,
  path: string,
): Promise<LocalFile> {
  const { full, local, git } = await validate(root, server, ref, head, path);
  const [disk, original] = await Promise.all([
    readBytes(full),
    git("show", `${head}:${path}`),
  ]);
  return {
    path: full,
    branch: local.branch,
    head,
    contents: decode(disk.bytes),
    original: decode(original),
    version: disk.version,
  };
}

export async function saveLocalFile(
  root: string,
  server: string,
  ref: PullRef,
  head: string,
  path: string,
  version: string,
  contents: string,
) {
  const bytes = Buffer.from(contents, "utf8");
  decode(bytes);
  const key = join(root, path);
  const previous = saves.get(key);
  const task = (async () => {
    await previous?.catch(() => {});
    const { full, local } = await validate(root, server, ref, head, path);
    const disk = await readBytes(full);
    if (!(disk.mode & 0o222))
      throw new Error(
        "This file is read-only. Change its permissions in your IDE before saving.",
      );
    const check = (current: { version: string }) => {
      if (current.version !== version)
        throw new Error(
          "This file changed on disk since you opened or saved it. Your edits are still here. Copy them or reload the disk version before saving.",
        );
    };
    check(disk);
    const temporary = join(
      dirname(full),
      `.${basename(full)}.relay-${randomUUID()}.tmp`,
    );
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.chmod(disk.mode);
      await handle.sync();
      await handle.close();
      // Recheck immediately before replacing, including a checkout/parent change during the write.
      await validate(local.path, server, ref, head, path);
      check(await readBytes(full));
      await rename(temporary, full);
      return { version: hash(bytes) };
    } finally {
      await handle.close().catch(() => {});
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  })();
  saves.set(key, task);
  try {
    return await task;
  } finally {
    if (saves.get(key) === task) saves.delete(key);
  }
}
