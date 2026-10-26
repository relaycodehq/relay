import { join } from "node:path";
import { app } from "electron";
import { LocalHistoryStore } from "./store";

export { LocalHistoryStore } from "./store";
import { currentText, saveWithHistory } from "./save-hook";
export { recordTurnHistory } from "./turn";
import { historyKey } from "./history-key";
export { historyKey };
export { revertToVersion } from "./revert";

let shared: LocalHistoryStore | null | undefined;

/**
 * The history kept under `<userData>/local-history`, made on first use.
 * Null where there is no app to ask for the folder, such as a unit test that
 * loads `electron` as the path of its binary.
 */
export function localHistory() {
  if (shared === undefined)
    shared =
      typeof app?.getPath === "function"
        ? new LocalHistoryStore(join(app.getPath("userData"), "local-history"))
        : null;
  return shared;
}


/**
 * Runs a project file's `save`, keeping what it wrote in the file's history.
 * A save never waits on or fails because of the history.
 */
export async function saveKept<T>(
  root: string,
  path: string,
  contents: string,
  save: () => Promise<T>,
) {
  const history = localHistory();
  if (!history) return save();
  let file: string;
  try {
    file = await historyKey(root, path);
  } catch (e) {
    // The save reports a folder that's gone in its own words.
    console.warn("Local History could not place a file:", e);
    return save();
  }
  return saveWithHistory(
    history,
    file,
    contents,
    () => currentText(file),
    save,
  );
}
