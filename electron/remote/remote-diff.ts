// A file's diff as phones show it: hunks of numbered lines, cut off past
// `maxDiffLines`.
import { structuredPatch } from "diff";
import type {
  RemoteDiff,
  RemoteDiffLine,
  RemoteDiffSource,
} from "../../shared/remote";
import type { ApiMethod, FilePair } from "../../shared/types";

const maxDiffLines = 3000;

/** The desktop call that reads the file pair a phone's diff shows. */
export function diffCall(source: RemoteDiffSource): [ApiMethod, unknown[]] {
  switch (source.kind) {
    case "turn":
      return [
        "projectTurnDiff",
        [source.chatId, source.messageId, source.path],
      ];
    case "working":
      return ["projectWorkingDiff", [source.where, source.path, source.area]];
    case "commit":
      return ["projectCommitDiff", [source.where, source.sha, source.path]];
    case "worktree":
      return ["projectWorktreeDiff", [source.chatId, source.path]];
  }
}

export function toRemoteDiff(path: string, pair: FilePair): RemoteDiff {
  if (pair.binary) return { path, binary: true, hunks: [], truncated: false };
  const patch = structuredPatch(
    pair.old?.name ?? path,
    pair.next?.name ?? path,
    pair.old?.contents ?? "",
    pair.next?.contents ?? "",
    undefined,
    undefined,
    { context: 3 },
  );
  let budget = maxDiffLines,
    truncated = false;
  const hunks: RemoteDiff["hunks"] = [];
  for (const h of patch.hunks) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    let old = h.oldStart,
      next = h.newStart;
    const lines: RemoteDiffLine[] = [];
    for (const raw of h.lines) {
      if (raw.startsWith("\\")) continue;
      if (budget-- <= 0) {
        truncated = true;
        break;
      }
      const text = raw.slice(1);
      if (raw[0] === "+") lines.push({ kind: "add", text, new: next++ });
      else if (raw[0] === "-") lines.push({ kind: "del", text, old: old++ });
      else lines.push({ kind: "same", text, old: old++, new: next++ });
    }
    hunks.push({
      header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
      lines,
    });
  }
  return { path, binary: false, hunks, truncated };
}
