import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog } from "electron";
import { z } from "zod";
import { summarizeUsage, usageRanges } from "../../shared/usage";
import { usageSamples } from "../agents/usage-history";
import { usageLog } from "../usage";
import { takes, type ApiContext, type Handlers } from "./context";

/** The Usage page: read from this computer's own log, never sent anywhere. */
export function usageHandlers(ctx: ApiContext) {
  const { store } = ctx;
  return {
    usageSummary: takes([z.enum(usageRanges)], async (range) => {
      const [entries, samples] = await Promise.all([
        usageLog(),
        usageSamples(),
      ]);
      const state = store.get();
      const names = new Map((state.projects ?? []).map((p) => [p.id, p.name]));
      const chats = (state.chats ?? [])
        // Reviewers and thinkers are parts of another thread, not threads of their own.
        .filter((c) => !c.reviewer && !c.thinker)
        .map((c) => ({
          id: c.id,
          title: c.title,
          project: names.get(c.projectId) ?? "",
          created: c.created,
          byAgent: !!c.startedBy,
          settledAt: c.settledAt,
        }));
      return summarizeUsage(entries, {
        range,
        now: Date.now(),
        chats,
        limits: { claude: samples.claude, codex: samples.codex },
      });
    }),
    /** The share card, saved where the user picks; null when they cancel. */
    saveUsageImage: takes(
      [
        z
          .string()
          .max(16 * 1024 * 1024)
          .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
        z.string().regex(/^[\w.-]{1,80}\.png$/),
      ],
      async (dataUrl, name) => {
        const result = await dialog.showSaveDialog(ctx.window.win!, {
          defaultPath: join(app.getPath("downloads"), name),
          filters: [{ name: "PNG image", extensions: ["png"] }],
        });
        if (result.canceled || !result.filePath) return null;
        await writeFile(
          result.filePath,
          Buffer.from(dataUrl.split(",")[1], "base64"),
        );
        return result.filePath;
      },
    ),
  } satisfies Handlers;
}
