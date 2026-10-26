import { z } from "zod";
import { digestSchema, textSchema } from "./validation";
import { workingPathSchema, type WorkingTree } from "./working-tree";

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

/** One change of one file, as the editor's change bar shows it. */
export const fileChangeSchema = z
  .object({
    path: workingPathSchema,
    /** What the editor compared with: HEAD's text for the file, "" when HEAD hasn't got it. */
    committed: textSchema,
    /** The whole file to commit: HEAD's text with just this change applied. */
    content: textSchema,
  })
  .strict();
export type FileChange = z.infer<typeof fileChangeSchema>;
export const commitFileChangeSchema = fileChangeSchema
  .extend({ message: z.string().max(16000) })
  .strict();
export type CommitFileChange = z.infer<typeof commitFileChangeSchema>;

/** Commits of part of the uncommitted changes: a planned split, or one change from the editor. */
export interface PartialCommitApi {
  /** A model's split of every uncommitted change into commits, not yet made. */
  projectPlanCommitSplit(
    where: string,
    note?: string,
  ): Promise<CommitSplitPlan>;
  projectApplyCommitSplit(
    where: string,
    split: ApplyCommitSplit,
  ): Promise<WorkingTree>;
  /** Commits just this change; the file's other edits stay uncommitted, and what was staged stays staged. */
  projectCommitFileChange(
    where: string,
    change: CommitFileChange,
  ): Promise<WorkingTree>;
  /** A generated message for committing just this change. */
  projectChangeCommitMessage(
    where: string,
    change: FileChange,
  ): Promise<string>;
}
