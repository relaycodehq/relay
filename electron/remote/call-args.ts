// What a phone may pass to the bridge's calls; anything else is refused
// before it reaches the desktop.
import { z } from "zod";
import { fileUploadChunk, maxUploadBytes } from "../../shared/remote";
import { idSchema } from "../../shared/validation";

const pathSchema = z.string().min(1).max(1000);
export const uploadSizeSchema = z.number().int().min(0).max(maxUploadBytes);
// A chunk may be up to twice `fileUploadChunk`, for phones that send bigger ones.
export const uploadChunkSchema = z
  .string()
  .max(Math.ceil((2 * fileUploadChunk) / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);
export const newsCursorSchema = z
  .object({ epoch: z.string().max(64), seq: z.number().int().min(0) })
  .strict();
export const activityIdSchema = z.string().min(1).max(200);
export const knownIconsSchema = z
  .record(idSchema, z.string().max(64).nullable())
  .refine((known) => Object.keys(known).length <= 1000);
export const signatureSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const imageSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("attached"),
      chatId: idSchema,
      imageId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("read"),
      chatId: idSchema,
      messageId: idSchema,
      path: pathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("preview"),
      chatId: idSchema,
      messageId: idSchema,
    })
    .strict(),
]);

export const diffSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("turn"),
      chatId: idSchema,
      messageId: idSchema,
      path: pathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("working"),
      where: z.string().max(80),
      path: pathSchema,
      area: z.enum(["staged", "unstaged"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("commit"),
      where: z.string().max(80),
      sha: z.string().max(64),
      path: pathSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("worktree"), chatId: idSchema, path: pathSchema })
    .strict(),
]);

/** The thread, message and call a phone opens a row of. */
export const callIds = (args: unknown[]) =>
  [
    idSchema.parse(args[0]),
    idSchema.parse(args[1]),
    activityIdSchema.parse(args[2]),
  ] as const;
