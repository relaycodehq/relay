import { readFile, stat } from "node:fs/promises";
import { NotText, decodeText, textLimit } from "../git/working-files";
import type { LocalHistoryStore } from "./store";

type History = Pick<LocalHistoryStore, "has" | "record">;

/**
 * Runs `save` and keeps what it wrote as a version of `file` (its real
 * path). A file with no history yet first has the text it is about to
 * replace kept, so the very first save can be taken back. History is never
 * allowed to fail a save: its errors are logged and the save goes on.
 */
export async function saveWithHistory<T>(
  history: History,
  file: string,
  contents: string,
  current: () => Promise<string | null>,
  save: () => Promise<T>,
): Promise<T> {
  try {
    if (!(await history.has(file))) {
      const before = await current();
      if (before !== null)
        void history
          .record(file, before, "external", "Before first save")
          .catch(warn);
    }
  } catch (e) {
    warn(e);
  }
  const result = await save();
  void history.record(file, contents, "save").catch(warn);
  return result;
}

/** What is on disk at `file`, or null when it is gone, binary or too large to have been editable. */
export async function currentText(file: string): Promise<string | null> {
  const info = await stat(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
  if (!info?.isFile() || info.size > textLimit) return null;
  try {
    return decodeText(await readFile(file));
  } catch (e) {
    if (e instanceof NotText) return null;
    throw e;
  }
}

function warn(e: unknown) {
  console.warn("Local History could not keep a version:", e);
}
