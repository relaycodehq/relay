import type { ChangedFile, FilePair, Pull } from "../../shared/types";

/**
 * A changed file's two sides, read through `raw(sha, path)`: the base side at
 * the merge base, the head side at the head commit. Binary or LFS-pointer
 * content comes back empty and flagged.
 */
export async function filePair(
  p: Pull,
  file: ChangedFile,
  raw: (sha: string, path: string) => Promise<string>,
): Promise<FilePair> {
  const head = p.head.sha,
    base = p.merge_base;
  const [old, next] = await Promise.all([
    file.status === "added"
      ? Promise.resolve(null)
      : raw(base, file.previous_filename || file.filename),
    file.status === "deleted"
      ? Promise.resolve(null)
      : raw(head, file.filename),
  ]);
  const binary = [old, next].some(
    (v) =>
      v !== null &&
      (v.includes("\0") ||
        v.startsWith("version https://git-lfs.github.com/spec/v1")),
  );
  return {
    old:
      old === null
        ? null
        : {
            name: file.previous_filename || file.filename,
            contents: binary ? "" : old,
            cacheKey: `${base}:${file.previous_filename || file.filename}`,
          },
    next:
      next === null
        ? null
        : {
            name: file.filename,
            contents: binary ? "" : next,
            cacheKey: `${head}:${file.filename}`,
          },
    binary,
  };
}
