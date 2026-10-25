import { z } from "zod";
import type { Repo } from "../types";
import { projectSoundsSchema } from "../sounds";
import { helperPickSchema } from "../settings";
import { linkedFoldersSchema } from "./links";
import { chatWorkspaceSchema } from "./threads";

export interface Project {
  /** Sidebar-only folder path; never a filesystem location. */
  folder?: string;
  id: string;
  /** Its folder; for a project on another computer, the folder there. */
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
  /**
   * Its folder is on a paired computer, not this one: its threads, Git and
   * files run there, and nothing here reads `path`.
   */
  computer?: ProjectComputer;
}

/** Where a project on another computer lives. */
export interface ProjectComputer {
  /** The paired computer (Settings → Computers). */
  id: string;
  /** Its name when the project was added; the paired computer's own name wins. */
  name: string;
  /** The project as that computer knows it. */
  projectId: string;
  /** The folder there has no Git repository. */
  plain?: true;
}

/** What reading the folder of a project on another computer says here. */
export const onComputerMessage = (p: Pick<Project, "name" | "computer">) =>
  `${p.name} is on ${p.computer?.name ?? "another computer"}; its folder isn't on this one.`;
const FOLDER_GONE = "This project’s folder is gone: ";
/** What reading a project's folder says once the folder was moved or deleted. */
export const folderGoneMessage = (path: string) => `${FOLDER_GONE}${path}`;

/** The missing folder's path when `error` says the project's folder is gone. */
export function goneFolder(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.startsWith(FOLDER_GONE)
    ? message.slice(FOLDER_GONE.length)
    : null;
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
    /** Heap limit of its live checks' compiler, in MB; see shared/checks. */
    checksMemoryMb: z.number().int().min(256).max(16384).optional(),
    /** Sounds for its threads; see shared/sounds. */
    sounds: projectSoundsSchema.optional(),
    /** Writes its Commit sheets' messages, picked in the sheet. */
    commitMessage: helperPickSchema.optional(),
  })
  .strict();
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
