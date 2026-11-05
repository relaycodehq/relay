import { BrowserWindow } from "electron";
import type { Preview } from "./preview-state";

/**
 * The preview's view in a window of its own, titled by `title` as the page
 * changes; `closed` runs once the window is gone.
 */
export function popOutWindow(
  preview: Preview,
  { title, closed }: { title: () => string; closed: () => void },
) {
  const view = preview.view!;
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: title(),
    backgroundColor: "#ffffff",
  });
  win.removeMenu?.();
  const fit = () => {
    const { width, height } = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  win.contentView.addChildView(view);
  preview.drawn = true;
  fit();
  win.on("resize", fit);
  const retitle = () => {
    if (!win.isDestroyed()) win.setTitle(title());
  };
  view.webContents.on("page-title-updated", retitle);
  win.on("closed", () => {
    view.webContents.off("page-title-updated", retitle);
    closed();
  });
  return win;
}
