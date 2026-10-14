import { Memes } from "../memes";
import { openPath } from "./open-path";
import type { ApiContext, Handlers } from "./context";

/** `/meme`'s folder in app data. */
export function memeHandlers(ctx: ApiContext) {
  const memes = new Memes(ctx.store.dir);
  return {
    memes: () => memes.state(),
    prepareMemes: () => memes.prepare(),
    openMemesFolder: async () => {
      await memes.prepare();
      await openPath(memes.folder);
    },
    openMemesList: async () => {
      await memes.prepare();
      await openPath(memes.list);
    },
  } satisfies Handlers;
}
