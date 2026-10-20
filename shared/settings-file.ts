import { z } from "zod";

/**
 * settings.json: preferences a person might keep in their dotfiles or change
 * from a script, which Relay picks up while it runs. Only what differs from
 * the defaults is written, so a later default still reaches everyone who left
 * it alone. What Relay remembers on its own (projects, windows, folds) and
 * secrets stay in its app data.
 */
export const SETTINGS_FILE_NAME = "settings.json";

export interface SettingsFileError {
  message: string;
  /** 1-based, where the file stopped making sense. */
  line: number;
  column: number;
}

export interface SettingsFileState {
  /** Where the file is, or would be before anything was saved. */
  path: string;
  /** The file's top level as last read cleanly; {} before it exists. */
  values: Record<string, unknown>;
  /** Set while the file on disk can't be read; `values` are then the last good ones. */
  error?: SettingsFileError;
}

const keySchema = z
  .string()
  .min(1)
  .max(100)
  .refine((key) => !["__proto__", "constructor", "prototype"].includes(key));

/** One value to put at `path` in the file; an undefined value removes the key. */
export const settingsEditSchema = z.object({
  path: z.array(keySchema).min(1).max(5),
  value: z.json().optional(),
});
export type SettingsEdit = z.infer<typeof settingsEditSchema>;
