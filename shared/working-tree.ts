import { z } from "zod";
import type { FilePair, Repo } from "./types";
import { filePathSchema } from "./validation";
// Windows also opens .git as ".git.", ".git ", "GIT~1" and ".git::$INDEX_ALLOCATION".
const dotGit = /^(\.git[. ]*|git~\d+)(:.*)?$/i;
export const workingPathSchema = filePathSchema.refine(
  (p) => !p.includes("\\") && !p.split("/").some((v) => !v || dotGit.test(v)),
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
  /** Lines added and removed across all uncommitted changes, against HEAD. */
  lines: { additions: number; deletions: number };
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
      /** Commit just these files, as they are on disk; the rest of the index stays put. */
      paths: z.array(workingPathSchema).min(1).max(1000).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("push"), revision: z.string() }).strict(),
  z.object({ kind: z.literal("pull"), revision: z.string() }).strict(),
  z.object({ kind: z.literal("fetch") }).strict(),
]);
export type GitAction = z.infer<typeof gitActionSchema>;
/** Starts the refusal of an action made on a view of the checkout that's since moved on. */
export const checkoutChanged = "Your checkout changed.";
/** Starts every failure that means Relay has no Git to run. */
export const gitMissing = "Git wasn’t found.";
export const isGitMissing = (error: unknown) =>
  error instanceof Error && error.message.startsWith(gitMissing);
/** The Git Relay runs: one chosen in Settings, or the one it found. */
export interface GitInfo {
  /** The executable, or null when none was found. */
  path: string | null;
  /** Set when the user chose `path` instead of leaving it to Relay. */
  chosen: boolean;
  /** Git's own version line, such as "git version 2.47.1.windows.1". */
  version: string | null;
  error: string | null;
}
export interface WorkingTreeApi {
  workingTree(repo: Repo): Promise<WorkingTree>;
  workingDiff(repo: Repo, path: string, area: ChangeArea): Promise<FilePair>;
  gitAction(repo: Repo, action: GitAction): Promise<WorkingTree>;
  gitInfo(): Promise<GitInfo>;
  /** Asks for the Git executable and uses it if it runs; null if cancelled. */
  chooseGit(): Promise<GitInfo | null>;
  /** Forgets the chosen Git and finds one again. */
  resetGit(): Promise<GitInfo>;
}
