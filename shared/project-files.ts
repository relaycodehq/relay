/** One row of a folder on disk, as the Files pane's tree shows it. */
export interface DirEntry {
  name: string;
  kind: "file" | "dir" | "link";
  size: number;
  /** Milliseconds since the epoch. */
  mtime: number;
  /** Matched by .gitignore, so it never shows in Git's own lists. */
  ignored: boolean;
}

export interface DirListing {
  entries: DirEntry[];
  /** The folder held more than `maxDirEntries`; the rest are left out. */
  truncated: boolean;
}

export const maxDirEntries = 5000;

/** How the pane opens a file: the editor, a picture, or a card with the way out. */
export interface FileInfo {
  path: string;
  kind: "text" | "image" | "other";
  size: number;
  mtime: number;
  mime?: string;
  /** Why an `other` file can't be edited here. */
  reason?: string;
}

const imageMimes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

export const imageMime = (path: string) =>
  imageMimes[path.split(".").pop()?.toLowerCase() ?? ""];

export const maxImageBytes = 25 * 1024 * 1024;

/** A single file or folder name, never a path. */
export const isEntryName = (name: string) =>
  !!name &&
  name !== "." &&
  name !== ".." &&
  !/[/\\\0]/.test(name) &&
  name.length <= 255;
