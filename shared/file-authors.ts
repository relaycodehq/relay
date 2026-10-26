import { z } from "zod";
import type { BlameQuery, LineBlame } from "./types";
import { filePathSchema, shaSchema } from "./validation";

export const fileAuthorsQuerySchema = z
  .object({ revision: shaSchema, path: filePathSchema })
  .strict();

export type FileAuthorsQuery = z.infer<typeof fileAuthorsQuerySchema>;

/** Who wrote each line of a file at a revision. */
export interface FileAuthors {
  authors: string[];
  /** Each line's author, by index into `authors`; the first line first. */
  lines: number[];
}

/** Line history in a project's folders. */
export interface BlameApi {
  localBlame(where: string, query: BlameQuery): Promise<LineBlame>;
  /** Every line's author at once, for the editor's hints over declarations. */
  localFileAuthors(where: string, query: FileAuthorsQuery): Promise<FileAuthors>;
}
