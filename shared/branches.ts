import { z } from "zod";
export interface BranchRef {
  name: string;
  ref: string;
  current: boolean;
  remote: boolean;
  worktree: boolean;
}
export interface BranchList {
  current: string;
  head: string;
  branches: BranchRef[];
}
export const branchActionSchema = z
  .object({
    kind: z.enum(["switch", "create"]),
    name: z.string().min(1).max(250),
    current: z.string().max(250),
    head: z.string().regex(/^[a-f0-9]{40,64}$/),
  })
  .strict();
export type BranchAction = z.infer<typeof branchActionSchema>;
