import { z } from "zod";
import { digestSchema } from "./validation";

/** One piece a split can place: a whole file, or one hunk of a changed file. */
export interface SplitChange {
  id: number;
  path: string;
  previousPath?: string;
  status: "added" | "deleted" | "modified" | "renamed";
  /** Where in the file a hunk sits, such as "lines 40–52"; absent for whole files. */
  part?: string;
  additions: number;
  deletions: number;
}
export interface PlannedCommit {
  message: string;
  changes: number[];
  /** Changes the model left out, gathered so nothing is silently dropped. */
  unplaced?: boolean;
}
export interface CommitSplitPlan {
  /** The uncommitted changes the plan was made for; applying checks they still match. */
  fingerprint: string;
  changes: SplitChange[];
  commits: PlannedCommit[];
  /** Who planned it, as Settings words the choice. */
  plannedBy: string;
}
export const MAX_SPLIT_COMMITS = 40;
export const commitSplitNoteSchema = z.string().trim().max(2000);
export const applyCommitSplitSchema = z
  .object({
    fingerprint: digestSchema,
    commits: z
      .array(
        z
          .object({
            message: z.string().trim().min(1).max(16000),
            changes: z.array(z.number().int().positive()).min(1).max(5000),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_SPLIT_COMMITS),
  })
  .strict();
export type ApplyCommitSplit = z.infer<typeof applyCommitSplitSchema>;
