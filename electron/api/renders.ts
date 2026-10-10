import { z } from "zod";
import { RENDER_MAX_PAGES } from "../../shared/html-render";
import {
  appRenderTheme,
  copyImage,
  saveAs,
  shootRender,
  standaloneHtml,
} from "../html-renders";
import { takes, type ApiContext, type Handlers } from "./context";

const targetSchema = z
  .object({
    chatId: z.string().max(100),
    renderId: z.string().max(100),
    page: z
      .number()
      .int()
      .min(0)
      .max(RENDER_MAX_PAGES - 1),
    title: z.string().max(200),
  })
  .strict();
const shotSchema = z
  .object({
    to: z.enum(["clipboard", "file"]),
    rect: z
      .object({
        x: z.number().finite().min(0),
        y: z.number().finite().min(0),
        width: z.number().finite().min(1).max(20_000),
        height: z.number().finite().min(1).max(20_000),
      })
      .strict()
      .optional(),
    width: z.number().int().min(100).max(4000),
    scale: z.number().finite().min(1).max(4),
  })
  .strict();

/** Copying and saving the pages answers showed with show_html. */
export function renderHandlers(ctx: ApiContext) {
  const window = () => {
    const win = ctx.window.win;
    if (!win) throw new Error("Pages can only be saved from Relay's window.");
    return win;
  };
  const read = (target: z.infer<typeof targetSchema>) =>
    ctx.projectChats.renderPage(target.chatId, target.renderId, target.page);
  return {
    exportRenderImage: takes(
      [targetSchema, shotSchema],
      async (target, shot) => {
        const win = window();
        const image = await shootRender(win, () => read(target), shot);
        if (shot.to === "clipboard") {
          await copyImage(image);
          return null;
        }
        return saveAs(
          win,
          target.title,
          { name: "PNG image", extension: "png" },
          image.toPNG(),
        );
      },
    ),
    saveRenderHtml: takes([targetSchema], async (target) => {
      const win = window();
      const html = standaloneHtml(
        await read(target),
        await appRenderTheme(win),
      );
      return saveAs(
        win,
        target.title,
        { name: "HTML page", extension: "html" },
        html,
      );
    }),
  } satisfies Handlers;
}
