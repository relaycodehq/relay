import { z } from "zod";
import type { Repo } from "../types";

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
