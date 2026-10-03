import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../git/git";

// Without Git there are no ignore rules, so these would bury the real files.
const skipped = new Set([".git", "node_modules", ".DS_Store"]);

/**
 * The regular files in a folder that isn't a Git repository, relative to it.
 * A repository inside lists its own files, its ignores applied. Stops once
 * past `limit`.
 */
export async function folderFiles(root: string, limit: number) {
  const files: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length > limit) return;
      if (skipped.has(entry.name)) continue;
      const path = prefix + entry.name;
      if (entry.isFile()) files.push(path);
      else if (entry.isDirectory()) {
        const full = join(dir, entry.name);
        const listed = await lstat(join(full, ".git")).then(
          () => repositoryFiles(full),
          () => null,
        );
        if (listed) files.push(...listed.map((name) => `${path}/${name}`));
        else await walk(full, path + "/");
      }
    }
  };
  await walk(root, "");
  return files;
}

const repositoryFiles = (root: string) =>
  git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .then((out) => out.split("\0").filter(Boolean))
    .catch(() => null);
