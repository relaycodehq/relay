import type { EditorView } from "@codemirror/view";
import type { LocalFile } from "../../../shared/types";
import { useLineBlame } from "../diff/LineBlame";
import { committedLineAt } from "./change-gutter";
import type { EditorTarget } from "./editor-types";
import { committedLine, lineChanges } from "./line-changes";

/** Characters past which the hover waits for the worker rather than diff the text itself. */
const SYNC_LIMIT = 200_000;

/**
 * Blame for the editor's lines, always against HEAD (or the PR's head): an
 * unchanged line at its place in the committed version, a changed one says it
 * isn't committed yet. Where the worker hasn't caught up with the latest edit,
 * a smaller file is compared here on hover instead.
 */
export function useEditorBlame({
  target,
  path,
  file,
  base,
  view,
  text,
  committed,
  plain,
  barsAreHead,
}: {
  target: EditorTarget;
  path: string;
  file: LocalFile | undefined;
  /** What the committed version is called in "not committed yet". */
  base: "HEAD" | "PR head";
  view: () => EditorView | undefined;
  /** The text once typing has settled. */
  text: string | undefined;
  committed: string | undefined;
  /** A folder without Git, so nothing to blame. */
  plain: boolean;
  /** The change bars compare with HEAD, so their hunks map lines to it. */
  barsAreHead: boolean;
}) {
  const revision = file?.head ?? ("head" in target ? target.head.sha : "");
  const edited = text !== undefined && committed !== undefined && text !== committed;

  /**
   * The committed line number for an editor line. Null means it is no line of
   * the file, undefined that its history can't be told.
   */
  const lineAt = (line: number) => {
    const current = view();
    if (!current) return line;
    const { doc } = current.state;
    // The empty line after a final newline is no line of the file's.
    const isTrailingEmptyLine =
      line === doc.lines && doc.length > 0 && doc.line(line).length === 0;
    if (line > doc.lines || isTrailingEmptyLine) return null;
    if (!edited) return line;
    const fromBars = barsAreHead ? committedLineAt(current, line) : null;
    if (fromBars !== null) return fromBars;
    if (committed === undefined) return undefined;
    if (committed.length + doc.length > SYNC_LIMIT) return undefined;
    return committedLine(lineChanges(committed, current.state.sliceDoc()), line);
  };
  const additions = {
    revision,
    path,
    label: "Local checkout",
    lineAt,
    ...(edited ? { unavailable: `Changed here since ${base}, not committed yet.` } : {}),
  };
  return useLineBlame(
    target,
    { deletions: undefined, additions: plain ? undefined : additions },
    "file",
  );
}
