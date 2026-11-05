import { z } from "zod";
import type { Entry } from "../agent-host/protocol";

/** How much of a dev server's output is kept. */
export const keepChars = 16 * 1024;

/** What the agent host keeps with a server it runs, for the next Relay. */
export const savedServer = z.object({
  provider: z.literal("dev-server"),
  folder: z.string(),
  port: z.number().int(),
  command: z.string(),
  env: z.record(z.string(), z.string()).optional(),
});

/** The output a server taken back after a restart printed last, as much as is kept. */
export function lastLines(entries: Entry[]) {
  const lines: string[] = [];
  let chars = 0;
  for (let i = entries.length - 1; i >= 0 && chars < keepChars; i--) {
    const entry = entries[i]!;
    if (entry.kind !== "line") continue;
    lines.push(entry.text);
    chars += entry.text.length + 1;
  }
  return lines.reverse();
}

export type SavedServer = z.infer<typeof savedServer>;
