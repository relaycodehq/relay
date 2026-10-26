import { z } from "zod";
import { digestSchema } from "./validation";
import { workingPathSchema } from "./working-tree";

/** Matches a search returns unless it is asked for fewer or more. */
export const defaultMatchLimit = 2000;
export const maxMatchLimit = 5000;

export const projectSearchQuerySchema = z
  .object({
    pattern: z.string().min(1).max(1000),
    regex: z.boolean(),
    caseSensitive: z.boolean(),
    wholeWord: z.boolean(),
    /** Globs, comma-separated: `*.ts, src/**`. A leading `!` excludes. */
    include: z.string().max(500).optional(),
    exclude: z.string().max(500).optional(),
    limit: z.number().int().min(1).max(maxMatchLimit).optional(),
  })
  .strict();
export type ProjectSearchQuery = z.infer<typeof projectSearchQuerySchema>;

/** Names the search a window runs, so its next one cancels it. */
export const searchSlotSchema = z.string().min(1).max(80);

export const replaceFilesSchema = z
  .array(z.object({ path: workingPathSchema, version: digestSchema }).strict())
  .min(1)
  .max(maxMatchLimit);
export type ReplaceFile = z.infer<typeof replaceFilesSchema>[number];

/** A replacement of 10,000 characters is already a paste, not a rename. */
export const replacementSchema = z.string().max(10_000);

export interface ProjectSearchMatch {
  /** 1-based. */
  line: number;
  /** 0-based offset into the line, in UTF-16 units like the editor's. */
  column: number;
  length: number;
  /** The line, trimmed around the match when it is long. */
  preview: string;
  /** Where `preview` starts in the line; the match is at `column - previewStart` in it. */
  previewStart: number;
}

export interface ProjectSearchFile {
  path: string;
  /** Digest of the file as searched, which `replaceProjectText` checks. */
  version: string;
  matches: ProjectSearchMatch[];
}

export interface ProjectSearchResult {
  files: ProjectSearchFile[];
  /** More matches exist than were returned: the cap or the time limit was hit. */
  truncated: boolean;
  elapsedMs: number;
  /** ripgrep when it is installed; the Node fallback is slower on big checkouts. */
  engine: "ripgrep" | "node";
  /** A newer search in the same slot took over; `files` is empty. */
  cancelled?: true;
}

export interface ProjectReplaceResult {
  replaced: { path: string; count: number; version: string }[];
  /** Files left alone, each with a sentence for why. */
  skipped: { path: string; reason: string }[];
}

export interface ProjectSearchApi {
  /**
   * Searches the workspace's text files (gitignored ones excluded). A new
   * search with the same `slot` from the same window cancels the old one.
   */
  searchProjectText(
    where: string,
    query: ProjectSearchQuery,
    slot: string,
  ): Promise<ProjectSearchResult>;
  /** Stops the window's search in `slot`, if one is running. */
  cancelProjectSearch(slot: string): Promise<void>;
  /**
   * Replaces every match of `query` in `files`, each refused when it changed
   * since the search that listed it. With regex on, `$1` and `$&` expand.
   */
  replaceProjectText(
    where: string,
    query: ProjectSearchQuery,
    replacement: string,
    files: ReplaceFile[],
  ): Promise<ProjectReplaceResult>;
}
