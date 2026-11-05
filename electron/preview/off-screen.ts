import type { BrowserWindow, NativeImage, WebContents } from "electron";
import { sleep } from "../util/sleep";
import type { Preview } from "./preview-state";

/** What an agent's screenshot of a preview never shown is taken at. */
const UNSHOWN_SIZE = { width: 1280, height: 800 };

/**
 * The page's frame, also while it's off screen: then at the size the panel
 * last gave it. `host` is the Relay window it can borrow a surface from.
 */
export async function drawFrame(
  preview: Preview,
  wc: WebContents,
  host: () => BrowserWindow | null,
): Promise<NativeImage | null> {
  const view = preview.view!;
  if (!preview.shown && !preview.popOut) {
    const { width, height } = view.getBounds();
    if (!width || !height) view.setBounds({ x: 0, y: 0, ...UNSHOWN_SIZE });
    if (!preview.drawn) await prime(preview, host());
  }
  // Chromium has no frame for a view just taken off a window at first.
  for (let attempt = 1; ; attempt++) {
    // Closed meanwhile (the thread moved): capturePage would throw, not reject.
    if (wc.isDestroyed()) return null;
    const image = await wc.capturePage().catch(() => null);
    if (image && !image.isEmpty()) return image;
    if (attempt === 10) throw new Error("The preview could not be drawn.");
    if (attempt === 4 && !preview.shown && !preview.popOut)
      await prime(preview, host());
    await sleep(100);
  }
}

/** Gives a view never shown a surface: a moment in the window, outside what it shows. */
async function prime(preview: Preview, win: BrowserWindow | null) {
  const view = preview.view;
  if (!win || win.isDestroyed() || !view)
    throw new Error("Relay's window is closed, so the preview can't be drawn.");
  const bounds = view.getBounds();
  view.setBounds({ ...bounds, x: 100_000, y: 0 });
  win.contentView.addChildView(view, 0);
  await sleep(50);
  // The panel may have asked for it meanwhile.
  if (preview.view !== view || preview.shown || preview.popOut) return;
  win.contentView.removeChildView(view);
  view.setBounds(bounds);
  preview.drawn = true;
}
