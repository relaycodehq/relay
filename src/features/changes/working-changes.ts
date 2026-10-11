// The local changes list: which files sit in the staged and working lists,
// how they're named and grouped, and where a selection goes as they move.
import {
  checkoutLabel,
  operationInProgress,
  isStaged,
  isUnstaged,
  type ChangeArea,
  type ChangeKind,
  type IgnoredTouch,
  type WorkingChange,
  type WorkingTree,
} from "../../../shared/working-tree";
import { parentOf } from "../../lib/file-tree";
import { agentName } from "../../../shared/agents";

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

/** A folder group in the staged or working list, as the collapsed ones are kept. */
export const folderKey = (area: ChangeArea, folder: string) =>
  `${area}:${folder}`;

export interface ChangeSection {
  area: ChangeArea;
  title: string;
  files: WorkingChange[];
  /** What its boxes do. */
  kind: "stage" | "unstage";
}

/**
 * In the staged list. A conflict only sits in the working one: nothing of it is
 * staged yet, and staging it is how it gets resolved.
 */
const listedStaged = (c: WorkingChange) => isStaged(c) && !c.conflict;

/** The staged list, then the working one; a partly staged file is in both. */
export const changeSections = (changes: WorkingChange[]): ChangeSection[] => [
  {
    area: "staged",
    title: "Staged changes",
    files: changes.filter(listedStaged),
    kind: "unstage",
  },
  {
    area: "unstaged",
    title: "Working changes",
    files: changes.filter(isUnstaged),
    kind: "stage",
  },
];

/** The staged or working list, or the gitignored files agents wrote. */
export type ListArea = ChangeArea | "ignored";

export interface SelectedChange {
  path: string;
  area: ListArea;
}

/**
 * Where `selected` goes once the tree changes: none when the file has no
 * changes left, the other list when its diff moved there, else `selected`.
 */
export function settleSelection(
  selected: SelectedChange,
  changes: WorkingChange[],
  ignored: IgnoredTouch[] = [],
): SelectedChange | null {
  if (selected.area === "ignored")
    return ignored.some((t) => t.path === selected.path) ? selected : null;
  const change = changes.find((c) => c.path === selected.path);
  if (!change) return null;
  if (selected.area === "unstaged" && !isUnstaged(change))
    return { ...selected, area: "staged" };
  if (selected.area === "staged" && !listedStaged(change))
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
  return listedStaged(change) ? "staged" : null;
}

/**
 * Why Git can't commit or push here for now, said to the user: a Git
 * operation, no branch, a conflict, no push remote. Undefined when it can.
 */
export function gitBlockedReason(tree: WorkingTree, action: "commit" | "push") {
  if (tree.operation)
    return `${operationInProgress(tree.operation)}. Finish it in your terminal first.`;
  if (!tree.branch)
    return `${checkoutLabel(tree)}. Switch to a branch to ${action}.`;
  if (action === "commit" && tree.changes.some((c) => c.conflict))
    return "Resolve the merge conflicts and stage them first.";
  if (action === "push" && !tree.pushTarget)
    return "This branch has no remote to push to.";
}

export const sideLabels = (area: ChangeArea) =>
  area === "staged"
    ? { deletions: "HEAD", additions: "Index" }
    : { deletions: "Index", additions: "Working file" };

/** The sides of an ignored file's diff, and what its header says about them. */
export function ignoredSides(touch: IgnoredTouch) {
  const agent = agentName(touch.agent);
  return {
    sides: { deletions: `Before ${agent}`, additions: "Now" },
    said:
      touch.before === "kept"
        ? `Before ${agent} → Now`
        : touch.before === "none"
          ? `Made by ${agent}`
          : `Written by ${agent} · no copy from before`,
  };
}

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
      ["staged", "unstaged", "ignored"].includes(selected.area as string)
        ? (selected as SelectedChange)
        : null,
    message: typeof s?.message === "string" ? s.message : "",
    grouped: s?.grouped === true,
  };
}
