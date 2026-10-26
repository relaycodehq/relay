import { z } from "zod";

/** Why a version was kept; Local History shows it in muted text next to the time. */
export const localHistoryReasons = [
  "save",
  "external",
  "agent",
  "before-revert",
  "label",
] as const;

export type LocalHistoryReason = (typeof localHistoryReasons)[number];
export const localHistoryReasonSchema = z.enum(localHistoryReasons);
export const localHistoryLabelSchema = z.string().trim().min(1).max(200);

/** One kept version of a file. */
export interface LocalHistoryEntry {
  id: string;
  /** Milliseconds since the epoch. */
  time: number;
  reason: LocalHistoryReason;
  /** A name for the version: the thread that edited the file, or what the user called it. */
  label?: string;
  /** Bytes of text. */
  size: number;
  /** SHA-256 of the text; two entries with one hash hold the same text. */
  hash: string;
  /** The text was over the size limit, so Relay noted the version but kept none of it. */
  skipped?: boolean;
}

/** A file's versions kept on this computer, independent of Git. */
export interface LocalHistoryApi {
  /** The kept versions of a file, newest first. */
  localHistoryList(where: string, path: string): Promise<LocalHistoryEntry[]>;
  /** The text of one kept version. */
  localHistoryRead(where: string, path: string, id: string): Promise<string>;
  /**
   * Keeps `contents` as a version. Null when it is the text already kept last
   * (a save or an external change, which don't repeat themselves).
   */
  localHistoryRecord(
    where: string,
    path: string,
    contents: string,
    reason: LocalHistoryReason,
    label?: string,
  ): Promise<LocalHistoryEntry | null>;
  /**
   * Writes a kept version to disk without an open buffer: keeps what is there
   * as "before-revert" first, then writes with the same guard as
   * `saveProjectFile` (`currentVersion` is the digest of the text on disk
   * the caller saw). The editor reverts in its buffer instead, so it is undoable.
   */
  localHistoryRevert(
    where: string,
    path: string,
    id: string,
    currentVersion: string,
  ): Promise<{ version: string }>;
}
