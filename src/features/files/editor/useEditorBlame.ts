import { useMemo, useRef } from "react";
import type { Pull } from "../../../../shared/types";
import { useLineBlame } from "../../diff/LineBlame";
import {
  committedLine,
  lineChanges,
  linesOf,
  type LineHunk,
} from "./line-changes";

/** Characters of both sides past which the hover waits for the worker rather than diff them itself. */
const SYNC_LIMIT = 200_000;

/**
 * Blame for the editor's lines. Beside the committed side, the local side
 * reads as committed only while untouched; once edited, its lines point at
 * the committed side instead. The file by itself blames its unchanged lines
 * at their committed place: where `hunks` says, or before the worker has
 * caught up with the buffer, worked out here on hover for a smaller file.
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
  // Worked out here once per buffer.
  const worked = useRef<{
    committed?: string;
    buffer?: string;
    hunks?: readonly LineHunk[];
  }>({});
  const comparing =
    view.edited &&
    !hunks &&
    committed !== undefined &&
    buffer !== undefined &&
    committed.length + buffer.length > SYNC_LIMIT;
  let ends: number | undefined;
  const lineAt = (line: number) => {
    if (buffer === undefined) return line;
    // The empty line after a final newline is no line of the file's.
    ends ??= linesOf(buffer).length;
    if (line > ends) return null;
    if (!view.edited) return line;
    if (hunks) return committedLine(hunks, line);
    if (committed === undefined || comparing) return undefined;
    if (
      worked.current.committed !== committed ||
      worked.current.buffer !== buffer
    )
      worked.current = {
        committed,
        buffer,
        hunks: lineChanges(committed, buffer),
      };
    return committedLine(worked.current.hunks!, line);
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
                    unavailable: comparing
                      ? `Still comparing with ${base}. Hover again in a moment.`
                      : `Changed here since ${base}, not committed yet.`,
                  }
                : {}),
            },
          },
    view.compare ? "split" : "file",
  );
}
