import { z } from "zod";
import { idSchema } from "../../shared/validation";
import { takes, type ApiContext } from "./context";
import { browserAnnotationSchema } from "../../shared/browser-annotations";

const previewKeySchema = z.union([
  idSchema,
  z.templateLiteral(["draft:", idSchema]),
]);

const boundsSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().min(0).max(20_000),
    height: z.number().min(0).max(20_000),
  })
  .strict();

/** The threads' previews: a browser each, over the panel. */
export function previewHandlers(ctx: ApiContext) {
  const previews = () => {
    if (!ctx.previews)
      throw new Error("Browser previews aren't available on a headless Relay.");
    return ctx.previews;
  };
  return {
    openPreview: takes([idSchema, idSchema.nullable()], (projectId, chatId) =>
      previews().open(projectId, chatId),
    ),
    placePreview: takes(
      [previewKeySchema, boundsSchema.nullable()],
      (key, bounds) => previews().place(key, bounds),
    ),
    navigatePreview: takes(
      [
        idSchema,
        idSchema.nullable(),
        z.url({ protocol: /^https?$/ }).max(8192),
        z.string().trim().min(1).max(8192).optional(),
      ],
      (projectId, chatId, url, command) =>
        previews().navigate(projectId, chatId, url, command),
    ),
    previewAction: takes(
      [
        previewKeySchema,
        z.enum([
          "back",
          "forward",
          "reload",
          "stop",
          "devtools",
          "popOut",
          "bringBack",
          "openExternal",
          "stopPicking",
        ]),
      ],
      (key, action) => previews().act(key, action),
    ),
    pickPreviewElement: takes(
      [previewKeySchema, z.array(browserAnnotationSchema)],
      (key, annotations) => previews().pick(key, annotations),
    ),
    closePreview: takes([previewKeySchema], (key) => previews().close(key)),
  };
}
