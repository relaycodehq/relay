import type { FilePair } from "../../../shared/types";
import type { FilesRequest } from "./file-link-target";
import { mediaOf } from "./MediaChange";
import { keepSnapshot } from "./snapshots";

/**
 * What Files opens for one file of a diff whose newer side is the file on
 * disk (a turn, a worktree against its branch, another repository): the file
 * itself, with its changes since the older side. One deleted since shows as
 * it was, a picture or video both sides of it, and anything else Git can't
 * read as text opens as it is.
 */
export function workingChange(
  pair: FilePair,
  file: { path: string; outside?: boolean },
  before: string,
  snapshotId: string,
): FilesRequest {
  const media = mediaOf(pair);
  if (media) {
    const sides = { deletions: before, additions: "Now" };
    keepSnapshot(snapshotId, { path: file.path, label: `${before} → now`, media, sides });
    return { snapshot: snapshotId, path: file.path };
  }
  if (pair.binary) return { ...file, directory: false };
  const old = pair.old?.contents ?? "";
  if (!pair.next) {
    keepSnapshot(snapshotId, { path: file.path, label: `${before}, deleted since`, text: old });
    return { snapshot: snapshotId, path: file.path };
  }
  return { ...file, directory: false, changes: true, baseline: { label: before, text: old } };
}

/**
 * What Files opens for one file of a commit: that version, read-only, with
 * what the commit changed in place. A file the commit deleted shows as it was
 * before, a picture or video both sides of it, and anything else Git can't
 * read as text opens as it is on disk.
 */
export function committedChange(
  pair: FilePair,
  path: string,
  commit: { short: string; parent: string },
  snapshotId: string,
): FilesRequest {
  const media = mediaOf(pair);
  if (media) {
    const sides = { deletions: commit.parent, additions: commit.short };
    keepSnapshot(snapshotId, { path, label: commit.short, media, sides });
    return { snapshot: snapshotId, path };
  }
  if (pair.binary) return { path, directory: false };
  const old = pair.old?.contents ?? "";
  const snapshot = pair.next
    ? {
        path,
        label: commit.short,
        text: pair.next.contents,
        baseline: { label: commit.parent, text: old },
      }
    : { path, label: `${commit.parent}, deleted in ${commit.short}`, text: old };
  keepSnapshot(snapshotId, snapshot);
  return { snapshot: snapshotId, path };
}
