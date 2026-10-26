import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { git } from "./git";

/**
 * Keeps `pattern` out of the repository's changes with its own exclude file,
 * which is never committed, so the project's `.gitignore` stays as it is.
 */
export async function excludeLocally(root: string, pattern: string) {
  const file = resolve(
    root,
    (await git(root, ["rev-parse", "--git-path", "info/exclude"])).trim(),
  );
  const before = await readFile(file, "utf8").catch(() => "");
  if (before.split(/\r?\n/).includes(pattern)) return;
  await mkdir(dirname(file), { recursive: true });
  const newline = before && !before.endsWith("\n") ? "\n" : "";
  await appendFile(file, `${newline}${pattern}\n`);
}
