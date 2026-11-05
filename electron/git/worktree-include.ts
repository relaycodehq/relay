// Copies the files a project lists in `.worktreeinclude` into a new worktree,
// the way Claude Code does: gitignore patterns, and only files both matched
// and ignored by Git, so a tracked file is never copied over its checkout.
import { cp, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { git } from "./git";
import { matches, parsePatterns, reaches } from "./ignore-patterns";

export const INCLUDE_FILE = ".worktreeinclude";

/** Files under an ignored folder a pattern reaches into, as `dir/…` paths. */
async function filesIn(source: string, dir: string) {
  const entries = await readdir(join(source, dir), {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  return entries
    .filter((e) => !e.isDirectory())
    .map((e) =>
      relative(source, join(e.parentPath, e.name)).split(sep).join("/"),
    );
}

/** Copies `entry`, a file or a `dir/`, unless `target` has it already; resolves to whether it did. */
async function copyEntry(source: string, target: string, entry: string) {
  const path = entry.replace(/\/$/, "");
  const to = join(target, path);
  if (await lstat(to).catch(() => null)) return false;
  await mkdir(dirname(to), { recursive: true });
  await cp(join(source, path), to, {
    recursive: true,
    force: false,
    errorOnExist: false,
    verbatimSymlinks: true,
    preserveTimestamps: true,
  });
  return true;
}

const warnSkipped = (entry: string) => (error: unknown) => {
  console.warn(`Could not copy ${entry} into the worktree:`, error);
  return false;
};

/**
 * Copies what `source`'s `.worktreeinclude` names from `source` into
 * `target`, leaving anything already there alone. Resolves to the copied
 * paths, folders ending in `/`; nothing without the file. Never throws: a
 * worktree missing a file is better than no worktree.
 */
export async function copyIncluded(source: string, target: string) {
  const text = await readFile(join(source, INCLUDE_FILE), "utf8").catch(
    () => null,
  );
  if (!text) return [];
  const copied: string[] = [];
  try {
    // Matched the way Git matches the ignore files in that repository.
    const ignoreCase =
      (
        await git(source, ["config", "--bool", "core.ignorecase"]).catch(
          () => "",
        )
      ).trim() === "true";
    const rules = parsePatterns(text, { ignoreCase });
    if (!rules.some((r) => !r.negate)) return [];
    // Wholly ignored folders come back as one `dir/` entry, so `node_modules`
    // isn't walked.
    const listed = await git(
      source,
      [
        "ls-files",
        "-z",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
      ],
      60000,
    );
    const take: string[] = [];
    for (const entry of listed.split("\0").filter(Boolean)) {
      const isDir = entry.endsWith("/");
      const path = isDir ? entry.slice(0, -1) : entry;
      if (matches(rules, path, isDir)) take.push(entry);
      else if (isDir && reaches(rules, path))
        for (const file of await filesIn(source, path))
          if (matches(rules, file, false)) take.push(file);
    }
    for (const entry of take)
      // One file that can't be read leaves the others to copy.
      if (await copyEntry(source, target, entry).catch(warnSkipped(entry)))
        copied.push(entry);
  } catch (e) {
    console.warn(`Could not copy ${INCLUDE_FILE} files into ${target}:`, e);
  }
  return copied;
}
