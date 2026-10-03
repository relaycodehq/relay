// The local changes list: which files sit in the staged and working lists,
// how they're named and grouped, and where a selection goes as they move.
import {
  isStaged,
  isUnstaged,
  type ChangeArea,
  type ChangeKind,
  type WorkingChange,
  type WorkingTree,
} from "../../../shared/working-tree";
import { parentOf } from "../../lib/file-tree";

export const changeLabels: Record<ChangeKind, string> = {
  added: "Added",
  deleted: "Deleted",
  modified: "Modified",
  conflict: "Conflict",
};

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

export interface ChangeSection {
  area: ChangeArea;
  title: string;
  files: WorkingChange[];
  /** What its boxes do. */
  kind: "stage" | "unstage";
}

/** The staged list, then the working one; a partly staged file is in both. */
export const changeSections = (changes: WorkingChange[]): ChangeSection[] => [
  {
    area: "staged",
    title: "Staged changes",
    files: changes.filter(isStaged),
    kind: "unstage",
  },
  {
    area: "unstaged",
    title: "Working changes",
    files: changes.filter(isUnstaged),
    kind: "stage",
  },
];

export interface SelectedChange {
  path: string;
  area: ChangeArea;
}

/**
 * Where `selected` goes once the tree changes: none when the file has no
 * changes left, the other list when its diff moved there, else `selected`.
 */
export function settleSelection(
  selected: SelectedChange,
  changes: WorkingChange[],
): SelectedChange | null {
  const change = changes.find((c) => c.path === selected.path);
  if (!change) return null;
  if (selected.area === "unstaged" && !isUnstaged(change))
    return { ...selected, area: "staged" };
  if (selected.area === "staged" && !isStaged(change))
    return { ...selected, area: "unstaged" };
  return selected;
}

/** The list a revealed file opens in. Agents leave their edits unstaged, so their diff comes first. */
export const revealArea = (change: WorkingChange): ChangeArea =>
  isUnstaged(change) ? "unstaged" : "staged";

/** The list a partly staged file also sits in, from `area`. */
export function otherArea(
  change: WorkingChange,
  area: ChangeArea,
): ChangeArea | null {
  if (area === "staged") return isUnstaged(change) ? "unstaged" : null;
  return isStaged(change) ? "staged" : null;
}

/** Why no commit can start here: a conflict, a Git operation, or no branch. */
export const commitBlocked = (tree: WorkingTree) =>
  tree.changes.some((c) => c.conflict) || !!tree.operation || !tree.branch;

export const sideLabels = (area: ChangeArea) =>
  area === "staged"
    ? { deletions: "HEAD", additions: "Index" }
    : { deletions: "Index", additions: "Working file" };

/** The commit message and the selected diff, kept per project. */
interface SavedChanges {
  selected: SelectedChange | null;
  message: string;
  grouped: boolean;
}

export function parseSavedChanges(saved: unknown): SavedChanges {
  const s = saved as Partial<Record<keyof SavedChanges, unknown>> | null;
  const selected = s?.selected as Partial<SelectedChange> | null | undefined;
  return {
    selected:
      typeof selected?.path === "string" &&
      ["staged", "unstaged"].includes(selected.area as string)
        ? (selected as SelectedChange)
        : null,
    message: typeof s?.message === "string" ? s.message : "",
    grouped: s?.grouped === true,
  };
}
