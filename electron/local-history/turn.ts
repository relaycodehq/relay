import type { TurnFileChange } from "../../shared/projects";
import { turnDiff } from "../git/turn-changes";
import { historyKey } from "./history-key";
import type { LocalHistoryStore } from "./store";

/** More than this many files in one turn is a refactor or a generator, not edits worth stepping back through. */
const MAX_FILES = 200;

/**
 * Keeps the text of each file an agent turn changed, before and after, as
 * "agent" versions labelled with the thread's title. The turn's snapshots
 * are Git commits, so this reads them back rather than copying files while
 * the agent runs. Binary and deleted files are left out; a "before" that
 * matches the newest version is not kept twice.
 */
export async function recordTurnHistory(
  history: Pick<LocalHistoryStore, "record">,
  root: string,
  messageId: string,
  files: TurnFileChange[],
  title: string,
) {
  const label = title.trim() || "Agent edit";
  for (const change of files.slice(0, MAX_FILES)) {
    if (change.binary) continue;
    try {
      const pair = await turnDiff(root, messageId, change.path);
      if (pair.binary || !pair.next) continue;
      // Keyed as saves are, so a path through a link shares the file's history.
      const file = await historyKey(root, change.path);
      if (pair.old)
        await history.record(
          file,
          pair.old.contents,
          "agent",
          `Before ${label}`,
        );
      await history.record(file, pair.next.contents, "agent", label);
    } catch (e) {
      console.warn(
        `Local History could not keep ${change.path} from a turn:`,
        e,
      );
    }
  }
}
