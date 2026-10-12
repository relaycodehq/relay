import { BrowserWindow } from "electron";
import { join } from "node:path";
import type { HeldSend } from "../../shared/drafts";
import { loadPage } from "../app/page";
import type { AppWindow } from "../app/window";

/** How long the hidden page lingers after a send, for the next to go quickly. */
const lingerMs = 60_000;

/**
 * Where a phone's send of a draft the desktop holds part of goes: the main
 * window's page, which has the screenshots, or with Relay in the menubar
 * alone a hidden page that opens for it, as the menubar's sounds do. A page
 * still loading asks for the sends waiting once it's up.
 */
export class DraftPages {
  private helper: { win: BrowserWindow; loaded: Promise<void> } | undefined;
  private linger: ReturnType<typeof setTimeout> | undefined;
  constructor(private window: AppWindow) {}

  deliver(request: HeldSend): boolean {
    const main = this.window.win;
    if (main && !main.isDestroyed()) {
      this.close();
      main.webContents.send("relay:draft-send", request);
      return true;
    }
    const { win, loaded } = this.open();
    void loaded
      .then(() => {
        if (!win.isDestroyed()) win.webContents.send("relay:draft-send", request);
      })
      .catch((e) => console.warn("The drafts page didn't load:", e));
    clearTimeout(this.linger);
    this.linger = setTimeout(() => this.close(), lingerMs);
    return true;
  }

  close() {
    clearTimeout(this.linger);
    this.helper?.win.destroy();
    this.helper = undefined;
  }

  private open() {
    if (this.helper && !this.helper.win.isDestroyed()) return this.helper;
    const win = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Hidden pages are throttled; a send waits on nothing.
        backgroundThrottling: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.on("closed", () => {
      if (this.helper?.win === win) this.helper = undefined;
    });
    this.window.trustHelper(win);
    this.helper = { win, loaded: loadPage(win, "drafts") };
    return this.helper;
  }
}
