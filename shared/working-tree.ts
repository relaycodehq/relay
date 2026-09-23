import { z } from "zod";
import type { FilePair, Repo } from "./types";
import { filePathSchema } from "./validation";
export const workingPathSchema = filePathSchema.refine(
  (p) =>
    !p.includes("\\") &&
    !p.split("/").some((v) => !v || v.toLowerCase() === ".git"),
  "Unsafe repository path",
);
export type ChangeArea = "staged" | "unstaged";
export interface WorkingChange {
  path: string;
  previousPath?: string;
  index: string;
  worktree: string;
  conflict: boolean;
}
export interface WorkingTree {
  head: string;
  branch: string;
  revision: string;
  changes: WorkingChange[];
  upstream: string | null;
  ahead: number;
  behind: number;
  pushTarget: string | null;
  pushUrl: string | null;
  operation: string | null;
  outgoing: { sha: string; subject: string }[];
}
export const gitActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stage"),
      revision: z.string(),
      paths: z.array(workingPathSchema).min(1).max(10000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unstage"),
      revision: z.string(),
      paths: z.array(workingPathSchema).min(1).max(10000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("commit"),
      revision: z.string(),
      message: z.string().trim().min(1).max(16000),
    })
    .strict(),
  z.object({ kind: z.literal("push"), revision: z.string() }).strict(),
  z.object({ kind: z.literal("pull"), revision: z.string() }).strict(),
  z.object({ kind: z.literal("fetch") }).strict(),
]);
export type GitAction = z.infer<typeof gitActionSchema>;
export interface WorkingTreeApi {
  workingTree(repo: Repo): Promise<WorkingTree>;
  workingDiff(repo: Repo, path: string, area: ChangeArea): Promise<FilePair>;
  gitAction(repo: Repo, action: GitAction): Promise<WorkingTree>;
}
