import {
  app,
  BrowserWindow,
  dialog,
  nativeImage,
  nativeTheme,
  type IpcMainInvokeEvent,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { threadTerminals } from "../terminal/thread-terminals";
import type { RelayEvents } from "../../shared/events";

const root = join(__dirname, "../dist/index.html");
const dev = process.env.RELAY_DEV_URL;

/** Windows has no badge count; a dot on the taskbar button stands in. */
function badgeDot() {
  const size = 16,
    pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2),
        alpha = Math.max(0, Math.min(1, size / 2 - d)),
        i = (y * size + x) * 4;
      // BGRA, premultiplied: #e5484d with an antialiased edge.
      pixels[i] = Math.round(0x4d * alpha);
      pixels[i + 1] = Math.round(0x48 * alpha);
      pixels[i + 2] = Math.round(0xe5 * alpha);
      pixels[i + 3] = Math.round(0xff * alpha);
    }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

/** Relay's one window: closed, it comes back from the menubar, the dock or a link. */
export class AppWindow {
  win: BrowserWindow | null = null;
  /** Startup has finished; until then only startup opens the window. */
  ready = false;
  /** The typography setting's share of the window zoom; ⌘+ and ⌘− add to it. */
  interfaceScale = 1;
  private closingToQuit = false;

  constructor(
    private hooks: {
      closed(): void;
      rendererGone(details: Electron.RenderProcessGoneDetails): void;
    },
  ) {}

  /** Pushes to the renderer; channels in `RelayEvents` must carry their payload. */
  send<C extends string>(
    channel: C,
    payload: C extends keyof RelayEvents ? RelayEvents[C] : unknown,
  ) {
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send(channel, payload);
  }

  show() {
    // Dock activation, a second launch and deep links all restore the same window.
    const win = this.win;
    if (!win) return;
    if (process.platform === "darwin") app.show();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  /** Shows the window, bringing a closed one back once Relay has started. */
  open() {
    if (!this.win && this.ready) this.create();
    this.show();
  }

  /**
   * Closes the window on the way to quitting; its unsaved-edits prompt can
   * still cancel. False when there is no window to close.
   */
  closeToQuit() {
    if (!this.win) return false;
    this.closingToQuit = true;
    this.win.close();
    return true;
  }

  setBadge(count: number) {
    if (process.platform === "win32")
      this.win?.setOverlayIcon(
        count ? badgeDot() : null,
        count
          ? `${count} ${count === 1 ? "thread needs" : "threads need"} you`
          : "",
      );
    else app.setBadgeCount(count);
  }

  /** Only Relay's own page, in its main frame, may call the API. */
  trusts(event: IpcMainInvokeEvent) {
    const source = event.senderFrame?.url;
    return (
      event.sender === this.win?.webContents &&
      event.senderFrame === this.win?.webContents.mainFrame &&
      (source === pathToFileURL(root).href ||
        (!app.isPackaged && source === `${dev}/`))
    );
  }

  create() {
    // Hidden while Relay sat in the menubar alone.
    if (process.platform === "darwin") void app.dock?.show();
    const win = new BrowserWindow({
      width: 1500,
      height: 960,
      minWidth: 1050,
      minHeight: 650,
      show: false,
      title: "Relay",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#202124" : "#f6f6f6",
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 20, y: 17 },
            vibrancy: "sidebar" as const,
            visualEffectState: "followWindow" as const,
          }
        : process.platform === "win32"
          ? // The renderer draws the caption buttons (WindowControls), centred
            // in the header; Windows' own overlay only sits flush to the top.
            { titleBarStyle: "hidden" as const }
          : {
              titleBarStyle: "hidden" as const,
              titleBarOverlay: {
                height: 51,
                color: nativeTheme.shouldUseDarkColors ? "#202124" : "#f6f6f6",
                symbolColor: nativeTheme.shouldUseDarkColors
                  ? "#ffffff"
                  : "#333333",
              },
            }),
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    this.win = win;
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    // The renderer's caption buttons swap maximize for restore.
    const sendMaximized = () =>
      this.win?.webContents.send("relay:maximized", this.win.isMaximized());
    win.on("maximize", sendMaximized);
    win.on("unmaximize", sendMaximized);
    // A reloaded window starts without terminals; shells keep their output until it asks.
    win.webContents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      threadTerminals.detach();
      // Settings may have been recording a shortcut when the page went.
      win.webContents.setIgnoreMenuShortcuts(false);
    });
    // Reloading Relay itself counts as a navigation too: Vite's full reload
    // after re-bundling dependencies and the error screen's button need it.
    // Every other destination stays blocked.
    win.webContents.on("will-navigate", (e) => {
      const target = URL.parse(e.url);
      if (target) target.hash = "";
      const page =
        dev && !app.isPackaged ? `${dev}/` : pathToFileURL(root).href;
      if (target?.href !== page) e.preventDefault();
    });
    // The font list, for the typography settings' font pickers, and the
    // microphone alone for dictation.
    win.webContents.session.setPermissionRequestHandler(
      (wc, permission, callback, details) =>
        callback(
          permission === "local-fonts" ||
            (permission === "media" &&
              wc === this.win?.webContents &&
              "mediaTypes" in details &&
              !!details.mediaTypes?.length &&
              details.mediaTypes.every((type) => type === "audio")),
        ),
    );
    win.webContents.session.setPermissionCheckHandler(
      (wc, permission, _origin, details) =>
        permission === "local-fonts" ||
        (permission === "media" &&
          wc === this.win?.webContents &&
          details.mediaType === "audio"),
    );
    win.once("ready-to-show", () => this.show());
    win.webContents.on("will-prevent-unload", (event) => {
      const choice = dialog.showMessageBoxSync(this.win!, {
        type: "warning",
        title: "Unsaved code edits",
        message: "Close without saving your code edits?",
        detail: "Choose Keep editing to save or copy your changes first.",
        buttons: ["Keep editing", "Discard edits and close"],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice === 1) event.preventDefault();
      else this.closingToQuit = false;
    });
    win.webContents.on("render-process-gone", (_event, details) =>
      this.hooks.rendererGone(details),
    );
    win.on("closed", () => {
      this.hooks.closed();
      // Only the window knows what's unread; a closed one can't clear it later.
      // (Windows quits with its last window, taking the overlay with it.)
      app.setBadgeCount(0);
      this.win = null;
      if (this.closingToQuit) {
        this.closingToQuit = false;
        app.quit();
      }
    });
    if (dev && !app.isPackaged) {
      // scripts/dev.mjs's URL: Vite's port, moved up in a worktree.
      const port = 5177 + (Number(process.env.RELAY_PORT_OFFSET) || 0);
      if (dev !== `http://127.0.0.1:${port}`)
        throw new Error("Invalid dev URL");
      void win.loadURL(dev);
    } else void win.loadFile(root);
  }
}
