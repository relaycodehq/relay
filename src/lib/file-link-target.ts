import {
  matchLink,
  type ProjectFileLink,
} from "../../shared/project-file-links";

/** A file for the Files pane to open. */
export type FileTarget = ProjectFileLink & {
  /** Lists the files matching this instead of opening one. */
  search?: string;
};

/**
 * The change a link clicked in the chat selects in Changes: a folder with
 * changes in it, or the one changed file it names. None when it names no
 * change, or several.
 */
export function changedTarget(
  link: ProjectFileLink,
  changes: readonly string[],
): ProjectFileLink | undefined {
  const changed = matchLink(link, changes);
  if (link.directory ? !changed.length : changed.length !== 1) return;
  return link.directory ? link : { ...link, path: changed[0] };
}

/**
 * What Files opens for a file link with no change: the one file of the
 * project's it names, the path itself when it's on disk but not in Git's
 * list, or else a search for it.
 */
export function fileTarget(
  link: ProjectFileLink,
  found: readonly string[],
  onDisk: boolean,
): FileTarget {
  return found.length === 1
    ? { ...link, path: found[0] }
    : onDisk
      ? link
      : { ...link, search: link.path };
}
