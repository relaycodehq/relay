// Changes to a review's saved progress: which files are viewed at which
// revision, the draft comments, and the lines marked as looked at.
import type { Draft, LineMark, Progress } from "../../shared/types";

/** Marks `path` viewed at `revision`, or unmarks it if it already is. */
export function toggleViewed(
  p: Progress,
  path: string,
  revision: string,
): Progress {
  const read = { ...p.read };
  if (read[path] === revision) delete read[path];
  else read[path] = revision;
  return { ...p, read };
}

/**
 * Marks a group's files viewed, or unmarks those viewed at `revision`.
 * `paths` is what the group holds now; only those still listed in it change,
 * and files with notes or open comments (`kept`) stay as they are.
 */
export function setGroupViewed(
  p: Progress,
  paths: string[],
  listed: string[],
  viewed: boolean,
  revision: string,
  kept: Set<string>,
): Progress {
  const read = { ...p.read };
  for (const path of paths)
    if (listed.includes(path) && !kept.has(path)) {
      if (viewed) read[path] = revision;
      else if (read[path] === revision) delete read[path];
    }
  return { ...p, read };
}

/** Adds `draft`, replacing the one with its id. */
export const putDraft = (p: Progress, draft: Draft): Progress => ({
  ...p,
  drafts: [...p.drafts.filter((d) => d.id !== draft.id), draft],
});

export const dropDraft = (p: Progress, id: string): Progress => ({
  ...p,
  drafts: p.drafts.filter((d) => d.id !== id),
});

/** After publishing: the summary clears and the published drafts go. */
export const afterSubmit = (p: Progress, published: string[]): Progress => ({
  ...p,
  reviewBody: "",
  drafts: p.drafts.filter((d) => !published.includes(d.id)),
});

export const addMark = (p: Progress, mark: LineMark): Progress => ({
  ...p,
  marks: [...p.marks, mark],
});

export const dropMark = (p: Progress, id: string): Progress => ({
  ...p,
  marks: p.marks.filter((m) => m.id !== id),
});
