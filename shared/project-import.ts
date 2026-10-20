import { z } from "zod";
import type { Project, ContinuedSession } from "./projects";
import type { TerminalSession } from "./terminal-sessions";
import { terminalSessionPickSchema } from "./terminal-sessions";

export const importAppSchema = z.enum(["codex", "claude"]);
export type ImportApp = z.infer<typeof importAppSchema>;
export const importAppNames: Record<ImportApp, string> = {
  codex: "Codex / ChatGPT",
  claude: "Claude",
};

/** A source app's project; its key is resolved again by the importer before writing. */
export interface ImportProject {
  key: string;
  name: string;
  path: string;
  missing: boolean;
  projectId?: string;
}
export type ImportChat = Pick<
  TerminalSession,
  "id" | "title" | "updated" | "turns" | "app" | "chatId"
>;
export const importSelectionSchema = z
  .object({
    key: z.string().min(1).max(100),
    /** Explicitly chosen when the source folder moved or was deleted. */
    folder: z.string().min(1).max(4096).optional(),
    chats: z.array(terminalSessionPickSchema.shape.session).max(10000),
  })
  .strict();
export type ImportSelection = z.infer<typeof importSelectionSchema>;
/** Partial failures keep successes visible and can be retried without duplicating them. */
export interface ProjectImportResult {
  projects: { key: string; project: Project; chats: ContinuedSession[] }[];
  failures: { key: string; chatId?: string; message: string }[];
}
