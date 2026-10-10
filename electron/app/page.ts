import { app, type BrowserWindow } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(__dirname, "../dist/index.html");
const dev = process.env.RELAY_DEV_URL;

/** Relay's own page, whatever query a window loaded it with. */
export function isRelayPage(url: string | undefined) {
  const target = url ? URL.parse(url) : null;
  if (!target) return false;
  target.hash = "";
  target.search = "";
  return (
    target.href === pathToFileURL(root).href ||
    (!app.isPackaged && !!dev && target.href === `${dev}/`)
  );
}

/** Loads Relay's page into `win`; `search` asks it to be something other than the app. */
export function loadPage(win: BrowserWindow, search?: string) {
  if (dev && !app.isPackaged) {
    // scripts/dev.mjs's URL: Vite's port, moved up in a worktree.
    const port = 5177 + (Number(process.env.RELAY_PORT_OFFSET) || 0);
    if (dev !== `http://127.0.0.1:${port}`) throw new Error("Invalid dev URL");
    return win.loadURL(search ? `${dev}/?${search}` : dev);
  }
  return win.loadFile(root, search ? { search } : undefined);
}
