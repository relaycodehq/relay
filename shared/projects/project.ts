import { z } from "zod";
import type { Repo } from "../types";
import { projectSoundsSchema } from "../sounds";
import { linkedFoldersSchema } from "./links";
import { chatWorkspaceSchema } from "./threads";

export interface Project {
  /** Sidebar-only folder path; never a filesystem location. */
  folder?: string;
  id: string;
  path: string;
  name: string;
  /** Original automatic name; null for a name typed by hand, absent in older saves. */
  automaticName?: string | null;
  repository: ({ server: string } & Repo) | null;
  added: number;
  /** Live: the folder isn't a Git repository, so it has no branches, changes or history. Never saved. */
  plain?: true;
  /** A Scratchpad chat's own folder in Relay's data, listed under Scratchpad instead of Projects. */
  scratch?: true;
  settings?: ProjectSettings;
  /** When it was removed from Relay; hidden until its folder is added again, threads and all. */
  removed?: number;
}
/** `relay-releases` → `Relay Releases`; letters after the first stay as typed. */
export const projectTitle = (folder: string) =>
  folder
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ") || folder;
/** A project's sidebar name, typed in place. */
export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Name the project.")
  .max(80)
  .refine((value) => !/[\x00-\x1f]/.test(value), "Use a plain name.");
const worktreeCommand = z.string().trim().min(1).max(4000);
/** What a project does its own way; anything unset follows the app's settings. */
export const projectSettingsSchema = z
  .object({
    /** Where its new threads start. */
    workspace: chatWorkspaceSchema.optional(),
    /** Quiet days before its threads settle; null never. */
    autoSettleDays: z.number().int().min(1).max(90).nullable().optional(),
    /** Its threads settle once a turn ends with the agent's own commit. */
    settleOnCommit: z.literal(true).optional(),
    /** Days after settling before its threads' worktrees are removed; null never. */
    worktreeCleanupDays: z.number().int().min(0).max(90).nullable().optional(),
    /** Runs in each new worktree before its thread's first turn. */
    worktreeSetup: worktreeCommand.optional(),
    /** Runs in a worktree before Relay removes it. */
    worktreeTeardown: worktreeCommand.optional(),
    /** Folders beyond the project its agents may reach; see shared/projects/links. */
    links: linkedFoldersSchema.optional(),
    /** Starts its dev server; a thread's preview runs it in the thread's folder when nothing listens yet. */
    devCommand: worktreeCommand.optional(),
    /** Where its dev server listens in the checkout; a worktree adds its RELAY_PORT_OFFSET. */
    devPort: z.number().int().min(1).max(65535).optional(),
    /** Sounds for its threads; see shared/sounds. */
    sounds: projectSoundsSchema.optional(),
  })
  .strict();
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
