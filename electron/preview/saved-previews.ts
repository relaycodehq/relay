import { z } from "zod";
import type { Store } from "../app/store";

const settings = z.object({
  devCommand: z.string().optional(),
  devPort: z.number().int().min(1).max(65535).optional(),
});

const savedPreview = z.object({
  projectId: z.string(),
  folder: z.string(),
  url: z.url({ protocol: /^https?$/ }),
  dev: z
    .object({
      port: z.number().int().min(1).max(65535),
      command: z.string().optional(),
    })
    .optional(),
  settings,
});

export type SavedPreview = z.infer<typeof savedPreview>;

/** Addresses and known launch commands stay on this computer, alongside its projects. */
export class SavedPreviews {
  private latest = new Map<string, SavedPreview>();
  constructor(private store: Pick<Store, "get" | "update">) {}

  get(projectId: string, key: string) {
    const saved =
      this.latest.get(key) ??
      savedPreview.safeParse(this.store.get().previews?.[key]).data;
    return saved?.projectId === projectId ? saved : undefined;
  }

  async set(key: string, value: SavedPreview) {
    if (
      JSON.stringify(this.get(value.projectId, key)) === JSON.stringify(value)
    )
      return;
    value = structuredClone(value);
    this.latest.set(key, value);
    try {
      await this.store.update((s) => {
        (s.previews ??= {})[key] = value;
      });
    } catch (error) {
      if (this.latest.get(key) === value) this.latest.delete(key);
      throw error;
    }
  }

  async forget(key: string) {
    this.latest.delete(key);
    if (!this.store.get().previews?.[key]) return;
    await this.store.update((s) => {
      delete s.previews?.[key];
    });
  }
}
