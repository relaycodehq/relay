import type { BrowserWindow } from "electron";
import { threadTerminals } from "../terminal/thread-terminals";
import type { AppWindow } from "./window";

/**
 * Sends a shell's output to the windows that opened it. What another
 * computer's shells print goes to every window.
 */
export function connectTerminals(windows: AppWindow) {
  threadTerminals.connect((event, viewer) => {
    if (viewer === undefined) return windows.send("relay:terminal", event);
    const win = windows.all().find((w) => !w.isDestroyed() && w.id === viewer);
    win?.webContents.send("relay:terminal", event);
  });
}

/**
 * A reloaded or closed window draws no terminals. Shells keep their output
 * until a window opens them again.
 */
export function detachTerminalsWhenGone(win: BrowserWindow) {
  const id = win.id;
  win.on("closed", () => threadTerminals.detach(id));
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument)
      threadTerminals.detach(id);
  });
}
