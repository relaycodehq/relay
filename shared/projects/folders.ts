/** What a folder picked or typed turns out to be. */
export type FolderInfo =
  | { path: string; kind: "missing" | "file" | "plain" | "repository" }
  /** Inside the repository at `root`, not its top. */
  | { path: string; kind: "inside"; root: string };

/** A folder inside another, as path completion lists it. */
export interface FolderEntry {
  name: string;
  path: string;
  /** It's the top of a Git repository. */
  repository: boolean;
}

/** A folder offered for linking. */
export interface LinkSuggestion {
  path: string;
  /** The Relay project at that folder, by name. */
  project?: string;
  repository: boolean;
  /** Next to the project's own folder. */
  beside: boolean;
}
