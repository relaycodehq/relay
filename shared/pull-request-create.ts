import { z } from "zod";
import type { PullRef } from "./types";
export interface BranchPull {
  ref: PullRef;
  title: string;
  base: string;
  url: string;
}
export interface PullRequestPlan {
  id: string;
  branch: string;
  head: string;
  base: string;
  bases: string[];
  title: string;
  existing: BranchPull[];
  needsPush: boolean;
  remote: string | null;
  destination: string;
  dirtyFiles: number;
  commits: { sha: string; subject: string }[];
}
export const createPullRequestSchema = z
  .object({
    planId: z.string().uuid(),
    base: z.string().min(1).max(250),
    title: z.string().trim().min(1).max(255),
    body: z.string().max(64000),
    draft: z.boolean(),
    push: z.boolean(),
  })
  .strict();
export type CreatePullRequest = z.infer<typeof createPullRequestSchema>;
export interface CreatedPullRequest {
  pull: BranchPull;
  warning?: string;
}
