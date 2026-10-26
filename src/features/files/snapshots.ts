import type { ChangeBaseline } from "../../../shared/editor-windows";
import type { Side } from "../../../shared/types";
import type { MediaPair } from "./MediaChange";

/** A version of a file that isn't on disk, like a commit's, shown read-only in a tab of its own. */
export type FileSnapshot = TextSnapshot | MediaSnapshot;

export type TextSnapshot = {
  path: string;
  /** Which version it is: a commit's short hash, "before turn". */
  label: string;
  text: string;
  /** What its changes show against, like the commit's parent. */
  baseline?: ChangeBaseline;
};

/** A picture or video's change, both sides of it. */
export type MediaSnapshot = {
  path: string;
  label: string;
  media: MediaPair;
  sides: Record<Side, string>;
};

/** Enough for the tabs a window keeps open and a few closed ones to come back. */
const KEPT = 40;
const kept = new Map<string, FileSnapshot>();

/**
 * Keeps `snapshot` for a tab to show. The id names the version (a commit and
 * a path), so opening it again finds the tab already open.
 */
export function keepSnapshot(id: string, snapshot: FileSnapshot) {
  kept.delete(id);
  kept.set(id, snapshot);
  for (const old of kept.keys()) {
    if (kept.size <= KEPT) break;
    kept.delete(old);
  }
}

export const snapshotOf = (id: string) => kept.get(id);
