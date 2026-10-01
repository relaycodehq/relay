import type { DiffLineAnnotation } from "@pierre/diffs";
import type { ProjectDiagnostic } from "../../shared/checks";
import type { Draft, LineMark, ReviewComment, Side } from "../../shared/types";

/** What sits under one line of a PR file's diff. */
export interface LineNotes {
  diagnostics: ProjectDiagnostic[];
  comments: ReviewComment[];
  drafts: Draft[];
  marks: LineMark[];
  /** The new comment's box opens here. */
  composer?: boolean;
  line: number;
  side: Side;
}

/** Where the new comment box is open; its text is a draft under `id`. */
export interface OpenComposer {
  id: string;
  line: number;
  side: Side;
}

/**
 * The notes for `path` at `head`, by line: published comments, this
 * revision's drafts and marks, and, while the checked file matches the
 * PR's, its diagnostics. The draft being written shows in the box instead.
 */
export function lineAnnotations({
  path,
  head,
  revision,
  comments,
  drafts,
  marks,
  diagnostics,
  composer,
}: {
  path: string;
  head: string;
  revision: string;
  comments: ReviewComment[];
  drafts: Draft[];
  marks: LineMark[];
  /** Only once the checked file is the one shown. */
  diagnostics: ProjectDiagnostic[];
  composer: OpenComposer | null;
}) {
  const map = new Map<string, DiffLineAnnotation<LineNotes>>();
  const get = (line: number, side: Side) => {
    const key = `${side}:${line}`;
    if (!map.has(key))
      map.set(key, {
        lineNumber: line,
        side,
        metadata: {
          line,
          side,
          comments: [],
          drafts: [],
          marks: [],
          diagnostics: [],
        },
      });
    return map.get(key)!.metadata;
  };
  for (const c of comments) {
    if (c.path !== path || c.commit_id !== head) continue;
    const line = c.position || c.original_position;
    if (line > 0)
      get(line, c.position > 0 ? "additions" : "deletions").comments.push(c);
  }
  for (const d of drafts)
    if (d.path === path && d.revision === revision && d.id !== composer?.id)
      get(d.line, d.side).drafts.push(d);
  for (const m of marks)
    if (m.path === path && m.revision === revision)
      get(m.end, m.side).marks.push(m);
  for (const d of diagnostics)
    if (d.line) get(d.line, "additions").diagnostics.push(d);
  if (composer) get(composer.line, composer.side).composer = true;
  return [...map.values()];
}
