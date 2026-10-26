import type { BrowserWindow } from "electron";
import type { MainWindowStore } from "./window";

/**
 * Saves where the main window is as it moves and resizes, a moment after it
 * settles, and as it closes. `store` is read at each save, so one kept later
 * still gets them.
 */
export function rememberPlace(
  win: BrowserWindow,
  store: () => MainWindowStore | undefined,
) {
  let placing: NodeJS.Timeout | undefined;
  const save = () => {
    clearTimeout(placing);
    const place = store();
    if (!place || win.isDestroyed()) return;
    place.save({
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
    });
  };
  const saveSoon = () => {
    clearTimeout(placing);
    placing = setTimeout(save, 500);
  };
  for (const event of [
    "resize",
    "move",
    "maximize",
    "unmaximize",
    "enter-full-screen",
    "leave-full-screen",
  ] as const)
    win.on(event as "resize", saveSoon);
  win.on("close", save);
}
