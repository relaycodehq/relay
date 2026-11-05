import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { digest } from "../util/hash";
import { workingPathSchema, type ChangeArea } from "../../shared/working-tree";
import type { FilePair } from "../../shared/types";
import { git, gitBytes } from "./git";
import { imageSides, type FileSource } from "./image-pair";
import { videoSides } from "./video-pair";
import { NotText, decodeText, readWorkingFile } from "./working-files";
import { parseStatusV2, statusArgs } from "./working-status";

/**
 * How `path` is changed now. The whole status, not just the path's: a rename
 * is only seen with both of its sides.
 */
async function changeOf(root: string, path: string) {
  workingPathSchema.parse(path);
  const status = parseStatusV2(await git(root, statusArgs));
  const at = status.changes.findIndex((c) => c.path === path);
  if (at < 0) throw new Error("This file no longer has local changes.");
  // `1 XY sub …`, where `sub` starts with S for a submodule.
  const submodule = /^[12] .. S/.test(status.rows[at]!);
  return { ...status.changes[at]!, submodule };
}

export async function workingDiff(
  root: string,
  path: string,
  area: ChangeArea,
): Promise<FilePair> {
  const c = await changeOf(root, path);
  if (c.conflict)
    throw new Error(
      "This file has merge conflicts. Resolve them in your editor, then stage the result.",
    );
  const staged = area === "staged",
    oldName = c.previousPath ?? path;
  const oldSource: FileSource | null = staged
      ? c.index === "A" || c.index === "?"
        ? null
        : { name: oldName, spec: `HEAD:${oldName}` }
      : c.index === "?" || c.index === "D"
        ? null
        : { name: path, spec: `:0:${path}` },
    nextSource: FileSource | null = staged
      ? c.index === "D"
        ? null
        : { name: path, spec: `:0:${path}` }
      : c.worktree === "D"
        ? null
        : { name: path, disk: true };
  return filePair(root, oldSource, nextSource, c.submodule);
}

/** The file as `oldSource` and `nextSource` have it, side by side; null for a side that doesn't exist. */
async function filePair(
  root: string,
  oldSource: FileSource | null,
  nextSource: FileSource | null,
  submodule: boolean,
): Promise<FilePair> {
  const read = async (source: FileSource | null) => {
    if (!source) return null;
    if (submodule) return submoduleSide(root, source);
    if ("spec" in source)
      return {
        name: source.name,
        contents: decodeText(await gitBytes(root, ["show", source.spec])),
        cacheKey: "",
      };
    // The shared safe reader rejects symlink parents and hardlinks.
    const value = await readWorkingFile(root, source.name);
    return value
      ? { name: source.name, contents: value.contents, cacheKey: value.hash }
      : null;
  };
  let old: FilePair["old"], next: FilePair["next"];
  try {
    old = await read(oldSource);
    next = await read(nextSource);
  } catch (e) {
    if (!(e instanceof NotText)) throw e;
    const [images, videos] = await Promise.all([
      imageSides(root, oldSource, nextSource),
      videoSides(root, oldSource, nextSource),
    ]);
    return { old: null, next: null, binary: true, images, videos };
  }
  for (const f of [old, next]) if (f) f.cacheKey ||= digest(f.contents);
  return { old, next, binary: false };
}

/**
 * A submodule's side as `git diff` writes it: the commit it points at, whose
 * contents live in the submodule's repository, not this one.
 */
async function submoduleSide(root: string, source: FileSource) {
  const commit = (
    "spec" in source
      ? await git(root, ["rev-parse", "-q", "--verify", source.spec]).catch(
          () => "",
        )
      : await checkedOutCommit(join(root, source.name))
  ).trim();
  if (!commit) return null;
  const contents = `Subproject commit ${commit}\n`;
  return { name: source.name, contents, cacheKey: digest(contents) };
}

/** The commit a submodule's folder has checked out; empty when it has none of its own. */
async function checkedOutCommit(dir: string) {
  // An uninitialised submodule is an empty folder, where Git would answer for the outer repository.
  if (!(await lstat(join(dir, ".git")).catch(() => null))) return "";
  return git(dir, ["rev-parse", "-q", "--verify", "HEAD"]).catch(() => "");
}

/**
 * A changed file against HEAD, staged and unstaged changes together: what a
 * thread's agent left in a repository other than its own.
 */
export async function headDiff(root: string, path: string): Promise<FilePair> {
  const c = await changeOf(root, path);
  if (c.conflict)
    throw new Error(
      "This file has merge conflicts. Resolve them in your editor first.",
    );
  const oldName = c.previousPath ?? path;
  return filePair(
    root,
    c.index === "A" || c.index === "?"
      ? null
      : { name: oldName, spec: `HEAD:${oldName}` },
    c.worktree === "D" || (c.index === "D" && c.worktree === " ")
      ? null
      : { name: path, disk: true },
    c.submodule,
  );
}
