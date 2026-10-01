import { z } from "zod";
import type { Repo } from "../types";
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
/** What a project does its own way; anything unset follows the app's settings. */
export const projectSettingsSchema = z
  .object({
    /** Where its new threads start. */
    workspace: chatWorkspaceSchema.optional(),
    /** Quiet days before its threads settle; null never. */
    autoSettleDays: z.number().int().min(1).max(90).nullable().optional(),
    /** Its threads settle once a turn ends with the agent's own commit. */
    settleOnCommit: z.literal(true).optional(),
  })
  .strict();
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
