import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { phoneAppChunk, type PhoneAppRelease } from "../../shared/remote";

const releaseSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    runtime: z.string().min(1).max(200),
    bundle: z.string(),
    files: z
      .array(
        z
          .object({
            // Relative, and never climbing out of the folder.
            path: z
              .string()
              .max(200)
              .regex(/^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/)
              .refine((p) => !p.split("/").includes("..")),
            size: z.number().int().nonnegative(),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .strict(),
      )
      .max(500),
  })
  .strict()
  .refine((r) => r.files.some((f) => f.path === r.bundle));

/**
 * The phone app's code this desktop carries, from the folder that
 * scripts/export-phone-bundle.mjs writes. Only files its manifest lists are
 * ever read. A build without one simply has no phone app to offer.
 */
export class PhoneAppFiles {
  private manifest?: Promise<PhoneAppRelease | undefined>;
  private cache = new Map<string, Promise<Buffer>>();
  constructor(private dir: string) {}

  release(): Promise<PhoneAppRelease | undefined> {
    return (this.manifest ??= readFile(join(this.dir, "manifest.json"), "utf8")
      .then((text) => releaseSchema.parse(JSON.parse(text)))
      .catch(() => undefined));
  }

  async chunk(path: string, offset: number): Promise<string> {
    const file = (await this.release())?.files.find((f) => f.path === path);
    if (!file) throw new Error("That file isn't part of the phone app.");
    if (offset > file.size) throw new Error("Past the end of the file.");
    let data = this.cache.get(path);
    if (!data) {
      data = readFile(join(this.dir, ...path.split("/")));
      this.cache.set(path, data);
      data.catch(() => this.cache.delete(path));
    }
    return (await data).subarray(offset, offset + phoneAppChunk).toString("base64");
  }
}
