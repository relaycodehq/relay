// Edits a thread's agents made outside the folder the thread works in: in
// another clone, another worktree or another project. The editor's Changes
// view lists them under their own repository, beside the thread's folder.
import type { TurnFileChange } from "./projects/messages";

/** One repository a turn's file tools wrote in, by its top folder. */
export interface ElsewhereEdits {
  root: string;
  /** Relative to `root`, with forward slashes. */
  paths: string[];
}

/** A thread that changed a file: this one, or one it started. */
export interface ElsewhereAuthor {
  chatId: string;
  title: string;
}

export type ElsewhereFile = TurnFileChange & {
  /** The threads it started that changed it; empty when only this one did. */
  by: ElsewhereAuthor[];
  /** This thread changed it too. */
  own: boolean;
  /** Not in the repository yet. */
  added?: true;
  deleted?: true;
};

export interface ElsewhereGroup {
  root: string;
  name: string;
  branch: string;
  /** The working tree it was read at; a commit made against another is refused. */
  revision: string;
  files: ElsewhereFile[];
}

export interface ElsewhereChanges {
  /** Other repositories, each with the files still uncommitted there. */
  groups: ElsewhereGroup[];
  /** Files in the thread's own folder that threads it started changed, by path. */
  here: Record<string, ElsewhereAuthor[]>;
}
