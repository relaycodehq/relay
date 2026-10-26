import { writeWorkingFile, readWorkingFile } from "../git/working-files";
import { digest } from "../util/hash";
import type { LocalHistoryStore } from "./store";

/**
 * Puts a kept version back on disk, for a file nobody has open (the editor
 * reverts in its buffer instead, so the change can be undone). What is there
 * now is kept first as "before-revert", but only if it is the text the caller
 * saw (`currentVersion`, "" for a file that's gone): a changed file stays as
 * it is and the write is refused, like a save is.
 */
export async function revertToVersion(
  history: Pick<LocalHistoryStore, "read" | "record">,
  root: string,
  path: string,
  file: string,
  id: string,
  currentVersion: string,
) {
  const contents = await history.read(file, id);
  const now = await readWorkingFile(root, path);
  if (now && now.hash === currentVersion)
    await history.record(file, now.contents, "before-revert");
  await writeWorkingFile(root, path, currentVersion || null, { contents });
  await history
    .record(file, contents, "save", "Reverted")
    .catch((e) => console.warn("Local History could not keep a revert:", e));
  return { version: digest(contents) };
}
