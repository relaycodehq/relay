// Lists of uncommitted changes: how files are named and grouped, and which
// list a partly staged file also sits in.
import {
  isStaged,
  isUnstaged,
  type ChangeArea,
  type WorkingChange,
} from "../../shared/working-tree";
import { parentOf } from "./file-tree";

export type ChangeKind = "added" | "deleted" | "modified" | "conflict";

export const changeLabels: Record<ChangeKind, string> = {
  added: "Added",
  deleted: "Deleted",
  modified: "Modified",
  conflict: "Conflict",
};

/** Porcelain status letter → how the file name is coloured. */
export function changeKind(code: string, conflict = false): ChangeKind {
  if (conflict) return "conflict";
  if (code === "A" || code === "?") return "added";
  if (code === "D") return "deleted";
  return "modified";
}

/** Files under their folder, in the order the folders first appear. */
export function byFolder(files: WorkingChange[]) {
  const folders = new Map<string, WorkingChange[]>();
  for (const c of files) {
    const folder = parentOf(c.path),
      group = folders.get(folder);
    if (group) group.push(c);
    else folders.set(folder, [c]);
  }
  return folders;
}

/** The list a partly staged file also sits in, from `area`. */
export function otherArea(
  change: WorkingChange,
  area: ChangeArea,
): ChangeArea | null {
  if (area === "staged") return isUnstaged(change) ? "unstaged" : null;
  return isStaged(change) ? "staged" : null;
}
