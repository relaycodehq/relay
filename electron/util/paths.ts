import { isAbsolute, relative, sep } from "node:path";

/**
 * `path` relative to `folder` when it lies in it, "" for the folder itself,
 * null outside it. A name that only starts with dots, like `..env`, is in it.
 */
export function within(folder: string, path: string): string | null {
  const rel = relative(folder, path);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
    ? null
    : rel;
}
