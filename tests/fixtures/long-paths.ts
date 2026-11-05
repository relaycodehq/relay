import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Writes 1,500 files of ~740-character paths under `root`, each holding its
 * own path, and returns the paths. Windows refuses a command line past 32k
 * characters, macOS past 1MB: these are past both, so a Git call that puts
 * them all in its arguments fails here too.
 */
export async function writeLongPaths(root: string) {
  const folder = Array.from({ length: 3 }, (_, i) => `${i}`.repeat(240)).join(
    "/",
  );
  await mkdir(join(root, folder), { recursive: true });
  const paths = Array.from(
    { length: 1500 },
    (_, i) => `${folder}/file-${String(i).padStart(4, "0")}.ts`,
  );
  await Promise.all(paths.map((p) => writeFile(join(root, p), p)));
  return paths;
}
