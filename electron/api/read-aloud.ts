import { z } from "zod";
import { takes, type ApiContext, type Handlers } from "./context";

const engineSchema = z.string().min(1).max(100);
const readingSchema = z.number().int().nonnegative();
const settingsSchema = z
  .object({
    engine: engineSchema.optional(),
    voices: z.record(engineSchema, z.string().max(100)),
    speed: z.number().min(0.25).max(4),
  })
  .strict();

/** Settings → Read aloud, and answers read aloud in the window. */
export function readAloudHandlers(ctx: ApiContext) {
  const { readAloud } = ctx;
  /** The window's readings still going, by the id it picked. */
  const readings = new Map<number, { stop(): void }>();
  return {
    readAloudState: () => readAloud.current,
    saveReadAloudSettings: takes([settingsSchema], (settings) =>
      readAloud.saveSettings(settings),
    ),
    downloadReadAloudEngine: takes([engineSchema], (id) =>
      readAloud.download(id),
    ),
    cancelReadAloudDownload: takes([engineSchema], (id) =>
      readAloud.cancelDownload(id),
    ),
    removeReadAloudEngine: takes([engineSchema], (id) => readAloud.remove(id)),
    readAloud: takes(
      [readingSchema, z.string().max(1_000_000)],
      (id, markdown) => {
        readings.get(id)?.stop();
        const reading = readAloud.speak(markdown, (speech) => {
          if (speech.type === "end" && readings.get(id) === reading)
            readings.delete(id);
          ctx.window.send("relay:read-aloud", { ...speech, id });
        });
        readings.set(id, reading);
      },
    ),
    stopReadAloud: takes([readingSchema], (id) => readings.get(id)?.stop()),
  } satisfies Handlers;
}
