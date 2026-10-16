import { useMemo, useRef } from "react";
import type { Pull } from "../../../../shared/types";
import { useLineBlame } from "../../diff/LineBlame";
import {
  committedLine,
  lineChanges,
  linesOf,
  type LineHunk,
} from "./line-changes";

/**
 * Blame for the editor's lines. Beside the committed side, the local side
 * reads as committed only while untouched; once edited, its lines point at
 * the committed side instead. The file by itself blames its unchanged lines
 * at their committed place: where `hunks` says, or before the worker has
 * caught up with the buffer, worked out here on hover.
 */
export function useEditorBlame(
  target: Pull | { projectId: string; head: { sha: string } },
  path: string,
  revision: string,
  /** What the committed side is: the project's HEAD or the PR's head. */
  base: "HEAD" | "PR head",
  view: {
    /** A folder without Git, so nothing to blame. */
    plain: boolean;
    compare: boolean;
    edited: boolean;
    committed: string | undefined;
    buffer: string | undefined;
    /** The buffer's edits since `revision`, once known for this buffer. */
    hunks: readonly LineHunk[] | undefined;
  },
) {
  const { committed, buffer, hunks } = view;
  // Changes when the worker finds lines moved, so an open hover goes; a
  // keystroke inside a line gives the same hunks and leaves it be.
  const shape = useMemo(() => hunks && JSON.stringify(hunks), [hunks]);
  const mapping = useRef({ shape, revision: 0 });
  if (shape !== undefined && mapping.current.shape !== shape)
    mapping.current = { shape, revision: mapping.current.revision + 1 };
  let worked: readonly LineHunk[] | undefined = hunks;
  let ends: number | undefined;
  const lineAt = (line: number) => {
    if (buffer === undefined) return line;
    // The empty line after a final newline is no line of the file's.
    ends ??= linesOf(buffer).length;
    if (line > ends) return null;
    if (!view.edited) return line;
    if (!worked && committed !== undefined)
      worked = lineChanges(committed, buffer);
    return worked ? committedLine(worked, line) : undefined;
  };
  const local = { revision, path, label: "Local checkout" };
  return useLineBlame(
    target,
    view.plain
      ? { deletions: undefined, additions: undefined }
      : view.compare
        ? {
            deletions: { revision, path, label: base },
            additions: {
              ...local,
              ...(view.edited
                ? {
                    unavailable:
                      base === "PR head"
                        ? "This local version differs from the PR. Hover the PR-head line on the left for committed history."
                        : "This local version differs from HEAD. Hover the HEAD line on the left for committed history.",
                  }
                : {}),
            },
          }
        : {
            deletions: undefined,
            additions: {
              ...local,
              lineAt,
              ...(view.edited
                ? {
                    mapping: mapping.current.revision,
                    unavailable: `Changed here since ${base}, not committed yet.`,
                  }
                : {}),
            },
          },
    view.compare ? "split" : "file",
  );
}
