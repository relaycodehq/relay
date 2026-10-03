import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
} from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, join } from "node:path";
import { git } from "../git/git";
import { decodeText, NotText, textLimit } from "../git/working-files";
import { workingPathSchema } from "../../shared/working-tree";
import {
  imageMime,
  maxDirEntries,
  maxImageBytes,
  type DirEntry,
  type DirListing,
  type FileInfo,
} from "../../shared/project-files";

// Git's own folder is off limits, and macOS litters every folder with this.
const hidden = new Set([".git", ".DS_Store"]);

/**
 * A file or folder inside the checkout ("" is the checkout itself), without
 * following a link on the way. `null` when nothing is there yet.
 */
async function resolveEntry(
  root: string,
  path: string,
): Promise<{ full: string; stat: Stats | null }> {
  if (path) workingPathSchema.parse(path);
  if ((await realpath(root)) !== root)
    throw new Error("The checkout path changed. Relink it first.");
  let full = root,
    stat: Stats | null = await lstat(root);
  for (const part of path ? path.split("/") : []) {
    if (!stat?.isDirectory()) throw new Error("That folder doesn’t exist.");
    full = join(full, part);
    stat = await lstat(full).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (stat?.isSymbolicLink())
      throw new Error("Symbolic links cannot be opened or changed here.");
  }
  return { full, stat };
}

async function existing(root: string, path: string) {
  const entry = await resolveEntry(root, path);
  if (!entry.stat) throw new Error("That is gone from disk.");
  return { full: entry.full, stat: entry.stat };
}

/** The paths Git ignores under `dir`, folders collapsed and marked with a trailing slash. */
async function ignoredUnder(root: string, dir: string) {
  const out = await git(
    root,
    [
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      ...(dir ? ["--", dir + "/"] : []),
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  ).catch(() => "");
  return new Set(out.split("\0").filter(Boolean));
}

/** One level of a folder straight from disk, ignored files included. */
export async function listDirectory(
  root: string,
  dir: string,
  plain: boolean,
): Promise<DirListing> {
  const { full, stat } = await existing(root, dir);
  if (!stat.isDirectory()) throw new Error("That is not a folder.");
  const names = (await readdir(full)).filter((n) => !hidden.has(n));
  // Without Git there are no ignore rules; the one folder nobody browses stands in.
  const ignored = plain
    ? new Set(
        names.includes("node_modules")
          ? [(dir ? dir + "/" : "") + "node_modules"]
          : [],
      )
    : await ignoredUnder(root, dir);
  const prefix = dir ? dir + "/" : "";
  const entries = (
    await Promise.all(
      names
        .slice(0, maxDirEntries)
        .map(async (name): Promise<DirEntry | null> => {
          const s = await lstat(join(full, name)).catch(() => null);
          if (!s) return null;
          const kind = s.isSymbolicLink()
            ? "link"
            : s.isDirectory()
              ? "dir"
              : "file";
          return {
            name,
            kind,
            size: s.size,
            mtime: s.mtimeMs,
            ignored:
              ignored.has(prefix + name) || ignored.has(prefix + name + "/"),
          };
        }),
    )
  ).filter((e): e is DirEntry => !!e);
  entries.sort(
    (a, b) =>
      Number(b.kind === "dir") - Number(a.kind === "dir") ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return { entries, truncated: names.length > maxDirEntries };
}

/** What a file is, so the pane can pick the editor, the picture, or the fallback card. */
export async function fileInfo(root: string, path: string): Promise<FileInfo> {
  const { full, stat } = await existing(root, path);
  if (!stat.isFile()) throw new Error("Choose a file.");
  const base = { path, size: stat.size, mtime: stat.mtimeMs };
  const mime = imageMime(path);
  if (mime) {
    if (stat.size <= maxImageBytes) return { ...base, kind: "image", mime };
    return {
      ...base,
      kind: "other",
      reason: "This image is too large to preview here.",
    };
  }
  if (stat.size > textLimit)
    return {
      ...base,
      kind: "other",
      reason: "Text files larger than 2 MiB are not opened here.",
    };
  try {
    decodeText(await readFile(full));
    return { ...base, kind: "text" };
  } catch (e) {
    if (e instanceof NotText)
      return { ...base, kind: "other", reason: e.message };
    throw e;
  }
}

/** An image as a data URL, for the viewer. */
export async function readImage(root: string, path: string) {
  const mime = imageMime(path);
  const { full, stat } = await existing(root, path);
  if (!mime || !stat.isFile()) throw new Error("That is not an image.");
  if (stat.size > maxImageBytes)
    throw new Error("This image is too large to preview here.");
  return `data:${mime};base64,${(await readFile(full)).toString("base64")}`;
}

/** A new empty file or folder; never replaces one that is there. */
export async function createEntry(
  root: string,
  path: string,
  kind: "file" | "dir",
) {
  const { full, stat } = await resolveEntry(root, path);
  if (stat) throw new Error("Something with that name already exists.");
  await parentFolder(root, path);
  if (kind === "dir") await mkdir(full, { mode: 0o755 });
  else await (await open(full, "wx", 0o644)).close();
}

/** Moves a file or folder to a new path in the same checkout, without replacing anything. */
export async function renameEntry(root: string, from: string, to: string) {
  const source = await existing(root, from);
  const target = await resolveEntry(root, to);
  // A case-only rename on a case-insensitive disk finds itself at the target.
  if (target.stat && target.stat.ino !== source.stat.ino)
    throw new Error("Something with that name already exists.");
  if (source.stat.isDirectory() && (to + "/").startsWith(from + "/"))
    throw new Error("A folder can’t move into itself.");
  await parentFolder(root, to);
  await rename(source.full, target.full);
}

async function parentFolder(root: string, path: string) {
  const parent = path.includes("/") ? dirname(path) : "";
  const { stat } = await resolveEntry(root, parent);
  if (!stat?.isDirectory()) throw new Error("That folder doesn’t exist.");
}

/** Where an entry is on disk, for Finder and the default app. */
export async function entryPath(root: string, path: string) {
  return (await existing(root, path)).full;
}
