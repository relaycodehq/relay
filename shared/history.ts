import { z } from "zod";
export const historyScopeSchema = z.enum(["head", "all"]);
export type HistoryScope = z.infer<typeof historyScopeSchema>;
export const historyLimitSchema = z.number().int().min(1).max(5000);
export const commitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
export interface CommitSummary {
  sha: string;
  parents: string[];
  author: string;
  /** Unix seconds. */
  time: number;
  /** Decorations such as "HEAD -> main", "origin/main" and "tag: v1". */
  refs: string[];
  subject: string;
}
export interface CommitLog {
  commits: CommitSummary[];
  /** Older commits exist past the limit. */
  more: boolean;
}
export interface CommitFileChange {
  path: string;
  previousPath?: string;
  status: "A" | "M" | "D" | "R" | "C" | "T";
  additions: number;
  deletions: number;
  binary: boolean;
}
export interface CommitDetail extends CommitSummary {
  email: string;
  body: string;
  /** Against the first parent; merges show what they brought in. */
  files: CommitFileChange[];
}
