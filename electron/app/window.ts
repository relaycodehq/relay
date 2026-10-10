import {
  app,
  BrowserWindow,
  dialog,
  nativeImage,
  nativeTheme,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents,
} from "electron";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import { threadTerminals } from "../terminal/thread-terminals";
import type { RelayEvents } from "../../shared/events";
import type { ThreadWindow } from "../../shared/thread-windows";
import { isRelayPage, loadPage } from "./page";
import { ThreadWindows } from "./thread-windows";

/** The window whose page made the API call running now. */
const callers = new AsyncLocalStorage<BrowserWindow | null>();

/** Runs `call` as one made from `win`'s page; see `AppWindow.caller`. */
export const callFrom = <T>(win: BrowserWindow | null, call: () => T) =>
  callers.run(win, call);

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

/**
 * Relay's main window, and the threads popped out of it into their own.
 * Closed, the main one comes back from the menubar, the dock or a link.
 */
export class AppWindow {
  win: BrowserWindow | null = null;
  /** Startup has finished; until then only startup opens the window. */
  ready = false;
  /** The typography setting's share of the window zoom; ⌘+ and ⌘− add to it. */
  interfaceScale = 1;
  readonly threads: ThreadWindows;
  private closingToQuit = false;
  /** A thread to open once the main window's page asks, as it loads. */
  private pendingThread?: ThreadWindow;

  constructor(
    private hooks: {
      closed(): void;
      quitCancelled(): void;
      /** `win`'s page is going, reloaded or closed; whatever it laid over itself goes too. */
      pageGone(win: BrowserWindow): void;
      rendererGone(details: Electron.RenderProcessGoneDetails): void;
    },
  ) {
    this.threads = new ThreadWindows({
      make: (bounds, unloadKept) =>
        this.build(
          {
            ...(bounds ?? { width: 1100, height: 900 }),
            minWidth: 560,
            minHeight: 500,
          },
          unloadKept,
        ),
      changed: (state) => this.send("relay:thread-windows", state),
      pageGone: (win) => hooks.pageGone(win),
      quitCancelled: () => hooks.quitCancelled(),
      returned: (thread) => this.openThread(thread),
    });
  }

  /** Pushes to every Relay window; channels in `RelayEvents` must carry their payload. */
  send<C extends string>(
    channel: C,
    payload: C extends keyof RelayEvents ? RelayEvents[C] : unknown,
  ) {
    for (const win of this.all())
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }

  /** The main window and every thread's own. */
  all(): BrowserWindow[] {
    return [...(this.win ? [this.win] : []), ...this.threads.windows()];
  }

  /** The window whose page made the API call running now, else the main one. */
  caller(): BrowserWindow | null {
    const from = callers.getStore();
    return from && !from.isDestroyed() ? from : this.win;
  }

  /** The window a thread's things lay over: its own if it has one, else the main one. */
  hostFor(key: string) {
    return this.threads.window(key) ?? this.win;
  }

  /** The Relay window in front, else the main one. */
  front() {
    const focused = BrowserWindow.getFocusedWindow();
    return focused && this.all().includes(focused) ? focused : this.win;
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

  /** Shows `thread` in the main window, opening the window if it's closed. */
  openThread(thread: ThreadWindow) {
    if (this.win && !this.win.webContents.isLoading()) {
      this.show();
      this.win.webContents.send("relay:open-thread", thread);
      return;
    }
    this.pendingThread = thread;
    this.open();
  }

  /** The thread the main window's page should open as it loads, once. */
  takeThread() {
    const thread = this.pendingThread;
    this.pendingThread = undefined;
    return thread ?? null;
  }

  /**
   * Closes the windows on the way to quitting, threads' first; each one's
   * unsaved-edits prompt can still cancel. False when none is left to close.
   */
  closeToQuit() {
    if (this.threads.closeToQuit()) return true;
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

  /** Only Relay's own page, in a Relay window's main frame, may call the API. */
  trusts(event: IpcMainInvokeEvent) {
    const win = this.all().find((w) => w.webContents === event.sender);
    return (
      !!win &&
      event.senderFrame === win.webContents.mainFrame &&
      isRelayPage(event.senderFrame?.url)
    );
  }

  private isRelay(wc: WebContents | null | undefined) {
    return !!wc && this.all().some((w) => w.webContents === wc);
  }

  create() {
    // Hidden while Relay sat in the menubar alone.
    if (process.platform === "darwin") void app.dock?.show();
    const win = this.build(
      { width: 1500, height: 960, minWidth: 1050, minHeight: 650 },
      () => {
        this.closingToQuit = false;
        this.hooks.quitCancelled();
      },
    );
    this.win = win;
    // A reloaded window starts without terminals; shells keep their output until it asks.
    win.webContents.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument)
        threadTerminals.detach();
    });
    win.webContents.on("render-process-gone", (_event, details) =>
      this.hooks.rendererGone(details),
    );
    win.on("closed", () => {
      this.hooks.closed();
      this.hooks.pageGone(win);
      // Only the window knows what's unread; a closed one can't clear it later.
      // (Windows quits with its last window, taking the overlay with it.)
      app.setBadgeCount(0);
      this.win = null;
      if (this.closingToQuit) {
        this.closingToQuit = false;
        app.quit();
      }
    });
    win.once("ready-to-show", () => this.show());
    void loadPage(win);
  }

  /**
   * A window for Relay's page, not loaded yet: its chrome, what its page may
   * do and reach, and the unsaved-edits prompt as it closes. `unloadKept`
   * runs when that prompt keeps it open.
   */
  private build(
    size: Partial<Rectangle> & {
      width: number;
      height: number;
      minWidth: number;
      minHeight: number;
    },
    unloadKept: () => void,
  ) {
    const win = new BrowserWindow({
      ...size,
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
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    // The renderer's caption buttons swap maximize for restore.
    const sendMaximized = () =>
      win.webContents.send("relay:maximized", win.isMaximized());
    win.on("maximize", sendMaximized);
    win.on("unmaximize", sendMaximized);
    win.webContents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.hooks.pageGone(win);
      // Settings may have been recording a shortcut when the page went.
      win.webContents.setIgnoreMenuShortcuts(false);
    });
    // Reloading Relay itself counts as a navigation too: Vite's full reload
    // after re-bundling dependencies and the error screen's button need it.
    // Every other destination stays blocked.
    win.webContents.on("will-navigate", (e) => {
      if (!isRelayPage(e.url)) e.preventDefault();
    });
    // The font list, for the typography settings' font pickers, and the
    // microphone alone for dictation.
    win.webContents.session.setPermissionRequestHandler(
      (wc, permission, callback, details) =>
        callback(
          permission === "local-fonts" ||
            (permission === "media" &&
              this.isRelay(wc) &&
              "mediaTypes" in details &&
              !!details.mediaTypes?.length &&
              details.mediaTypes.every((type) => type === "audio")),
        ),
    );
    win.webContents.session.setPermissionCheckHandler(
      (wc, permission, _origin, details) =>
        permission === "local-fonts" ||
        (permission === "media" &&
          this.isRelay(wc) &&
          details.mediaType === "audio"),
    );
    win.webContents.on("will-prevent-unload", (event) => {
      const choice = dialog.showMessageBoxSync(win, {
        type: "warning",
        title: "Unsaved code edits",
        message: "Close without saving your code edits?",
        detail: "Choose Keep editing to save or copy your changes first.",
        buttons: ["Keep editing", "Discard edits and close"],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice === 1) event.preventDefault();
      else unloadKept();
    });
    return win;
  }
}
