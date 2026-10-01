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
/** Has a diff between HEAD and the index; untracked files don't. */
export const isStaged = (c: WorkingChange) =>
  c.index !== " " && c.index !== "?";
/** Has a diff between the index and the file on disk, or is in conflict. */
export const isUnstaged = (c: WorkingChange) =>
  c.worktree !== " " || c.conflict;
export type ChangeKind = "added" | "deleted" | "modified" | "conflict";
/** Porcelain status letter → how the file name is coloured. */
export function changeKind(code: string, conflict = false): ChangeKind {
  if (conflict) return "conflict";
  if (code === "A" || code === "?") return "added";
  if (code === "D") return "deleted";
  return "modified";
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
  z
    .object({
      kind: z.literal("ignore"),
      revision: z.string(),
      paths: z.array(workingPathSchema).min(1).max(1000),
      /** The shared .gitignore, or .git/info/exclude for this clone only. */
      file: z.enum(["gitignore", "exclude"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("discard"),
      revision: z.string(),
      paths: z.array(workingPathSchema).min(1).max(1000),
      /** Working changes go back to the index; staged ones, and the rest, back to HEAD. */
      area: z.enum(["staged", "unstaged"]),
    })
    .strict(),
  z.object({ kind: z.literal("push"), revision: z.string() }).strict(),
  z.object({ kind: z.literal("pull"), revision: z.string() }).strict(),
  z.object({ kind: z.literal("fetch") }).strict(),
]);
export type GitAction = z.infer<typeof gitActionSchema>;
export interface Commit {
  sha: string;
  subject: string;
}
/**
 * Rebasing a diverged branch onto its upstream. A conflict changes nothing:
 * it says what came in, what's ours, and which files the first clash stopped on.
 */
export type RebaseResult =
  | { rebased: true; tree: WorkingTree }
  | {
      rebased: false;
      tree: WorkingTree;
      upstream: string;
      incoming: Commit[];
      outgoing: Commit[];
      conflicts: string[];
    };
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
  /**
   * Uses the Git at `path`, or one chosen in a file dialog when it's left
   * out, if it runs as Git; null if cancelled.
   */
  chooseGit(path?: string): Promise<GitInfo | null>;
  /** Forgets the chosen Git and finds one again. */
  resetGit(): Promise<GitInfo>;
}
