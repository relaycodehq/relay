import type { RemoteDiff, RemoteDiffLine } from "../../../shared/remote";

export type SplitRow =
  | { kind: "hunk"; header: string }
  | { kind: "pair"; left?: RemoteDiffLine; right?: RemoteDiffLine };

/**
 * A diff as side-by-side rows: unchanged lines on both sides, and each run of
 * removed lines set against the added lines that replaced it, one for one,
 * with a blank side where one run is longer.
 */
export function splitRows(diff: RemoteDiff): SplitRow[] {
  const rows: SplitRow[] = [];
  for (const hunk of diff.hunks) {
    rows.push({ kind: "hunk", header: hunk.header });
    let removed: RemoteDiffLine[] = [];
    let added: RemoteDiffLine[] = [];
    const flush = () => {
      for (let i = 0; i < Math.max(removed.length, added.length); i++)
        rows.push({ kind: "pair", left: removed[i], right: added[i] });
      removed = [];
      added = [];
    };
    for (const line of hunk.lines) {
      if (line.kind === "del") {
        // A removal after additions starts a new change.
        if (added.length) flush();
        removed.push(line);
      } else if (line.kind === "add") added.push(line);
      else {
        flush();
        rows.push({ kind: "pair", left: line, right: line });
      }
    }
    flush();
  }
  return rows;
}
