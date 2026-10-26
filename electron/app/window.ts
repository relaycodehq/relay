import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  screen,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents,
} from "electron";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import { threadTerminals } from "../terminal/thread-terminals";
import type { RelayEvents } from "../../shared/events";
import {
  placeOnScreen,
  type MainWindowCommand,
  type SavedMainWindow,
  type ThreadWindow,
} from "../../shared/thread-windows";
import { badgeDot } from "./badge-dot";
import { isRelayPage, loadPage } from "./page";
import { ThreadWindows } from "./thread-windows";
import { EditorWindows } from "./editor-windows";
import { show as showWindow } from "./popped-windows";

/** The window whose page made the API call running now. */
const callers = new AsyncLocalStorage<BrowserWindow | null>();
const pageErrorLimit = 100;
/** The main window's narrowest, with the projects sidebar and without it (a thread window's). */
const MAIN_MIN_WIDTH = { sidebar: 1050, alone: 560 };

/** Where the main window's size and state are kept between runs. */
export interface MainWindowStore {
  load(): SavedMainWindow | null;
  save(window: SavedMainWindow): void;
}

/** Runs `call` as one made from `win`'s page; see `AppWindow.caller`. */
export const callFrom = <T>(win: BrowserWindow | null, call: () => T) =>
  callers.run(win, call);

/**
 * Relay's main window, and the threads and editors popped out of it into
 * their own.
 * Closed, the main one comes back from the menubar, the dock or a link.
 */
export class AppWindow {
  win: BrowserWindow | null = null;
  /** Startup has finished; until then only startup opens the window. */
  ready = false;
  /** The typography setting's share of the window zoom; ⌘+ and ⌘− add to it. */
  interfaceScale = 1;
  readonly threads: ThreadWindows;
  readonly editors: EditorWindows;
  private closingToQuit = false;
  /** A thread to open once the main window's page asks, as it loads. */
  private pendingThread?: ThreadWindow;
  /** A command to run once the main window's page asks, as it loads. */
  private pendingCommand?: MainWindowCommand;
  /** The main window's minimum width its sidebar wants; see `fitSidebar`. */
  private sidebarMin = MAIN_MIN_WIDTH.sidebar;
  /** Hidden pages of Relay's own that may call the API, as a phone's draft send opens. */
  private helpers = new Set<BrowserWindow>();
  private place?: MainWindowStore;
  /**
   * Frosted glass (macOS): windows are built clear, so the vibrancy shows from
   * the first frame instead of once the page has loaded its appearance.
   */
  clear = false;
  private placing?: NodeJS.Timeout;

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
      make: this.popOutMaker({ width: 1100, height: 900 }),
      changed: (state) => this.send("relay:thread-windows", state),
      pageGone: (win) => hooks.pageGone(win),
      quitCancelled: () => hooks.quitCancelled(),
      returned: (thread) => this.openThread(thread),
    });
    this.editors = new EditorWindows({
      make: this.popOutMaker({ width: 1200, height: 900 }),
      changed: (state) => this.send("relay:editor-windows", state),
      pageGone: (win) => hooks.pageGone(win),
      quitCancelled: () => hooks.quitCancelled(),
      main: () => this.win,
      returned: (win) => (win ? showWindow(win) : this.open()),
    });
  }

  /** Builds a popped-out window where it was saved, else at `size`. */
  private popOutMaker(size: { width: number; height: number }) {
    return (bounds: Rectangle | undefined, unloadKept: () => void) =>
      this.build(
        {
          ...(bounds ?? size),
          minWidth: MAIN_MIN_WIDTH.alone,
          minHeight: 500,
        },
        unloadKept,
      );
  }

  /** Pushes to every Relay window; channels in `RelayEvents` must carry their payload. */
  send<C extends string>(
    channel: C,
    payload: C extends keyof RelayEvents ? RelayEvents[C] : unknown,
  ) {
    for (const win of this.all())
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }

  /** The main window, every thread's own and every editor's. */
  all(): BrowserWindow[] {
    return [
      ...(this.win ? [this.win] : []),
      ...this.threads.windows(),
      ...this.editors.windows(),
    ];
  }

  /** The window whose page made the API call running now, else the main one. */
  caller(): BrowserWindow | null {
    const from = callers.getStore();
    return from && !from.isDestroyed() ? from : this.win;
  }

  /**
   * The main window's minimum follows its sidebar. Shown by the user's
   * toggle in a window narrower than that, the window widens, staying on its
   * screen. Shown any other way, it keeps its size, and the narrower minimum
   * stays until the window grows past the sidebar's.
   */
  fitSidebar(shown: boolean, toggled: boolean) {
    const win = this.win;
    if (!win || win.isDestroyed() || callers.getStore() !== win) return;
    this.sidebarMin = shown ? MAIN_MIN_WIDTH.sidebar : MAIN_MIN_WIDTH.alone;
    const bounds = win.getBounds();
    if (
      toggled &&
      bounds.width < this.sidebarMin &&
      !win.isFullScreen() &&
      !win.isMaximized()
    ) {
      const area = screen.getDisplayMatching(bounds).workArea;
      const width = Math.min(this.sidebarMin, area.width);
      const x = Math.max(
        area.x,
        Math.min(bounds.x, area.x + area.width - width),
      );
      win.setBounds({ ...bounds, x, width }, true);
    }
    this.holdMinWidth(win);
  }

  /** Raises the minimum to the sidebar's only once the window is that wide. */
  private holdMinWidth(win: BrowserWindow) {
    const [width] = win.getSize();
    const [held, minHeight] = win.getMinimumSize();
    const minWidth = width >= this.sidebarMin ? this.sidebarMin : held;
    if (minWidth !== held) win.setMinimumSize(minWidth, minHeight);
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

  /** Runs `command` in the main window, opening the window if it's closed. */
  runCommand(command: MainWindowCommand) {
    if (this.win && !this.win.webContents.isLoading()) {
      this.show();
      this.win.webContents.send("relay:main-command", command);
      return;
    }
    this.pendingCommand = command;
    this.open();
  }

  /** The command the main window's page should run as it loads, once. */
  takeCommand() {
    const command = this.pendingCommand;
    this.pendingCommand = undefined;
    return command ?? null;
  }

  /** The thread the main window's page should open as it loads, once. */
  takeThread() {
    const thread = this.pendingThread;
    this.pendingThread = undefined;
    return thread ?? null;
  }

  /**
   * Closes the windows on the way to quitting, editors' and threads' first;
   * each one's unsaved-edits prompt can still cancel. False when none is left
   * to close.
   */
  closeToQuit() {
    if (this.editors.closeToQuit()) return true;
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

  /** Lets a hidden page of Relay's own call the API, until it closes. */
  trustHelper(win: BrowserWindow) {
    this.helpers.add(win);
    win.on("closed", () => this.helpers.delete(win));
  }

  /** Only Relay's own page, in a Relay window's main frame, may call the API. */
  trusts(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">) {
    const win = [...this.all(), ...this.helpers].find(
      (w) => w.webContents === event.sender,
    );
    return (
      !!win &&
      event.senderFrame === win.webContents.mainFrame &&
      isRelayPage(event.senderFrame?.url)
    );
  }

  private isRelay(wc: WebContents | null | undefined) {
    return !!wc && this.all().some((w) => w.webContents === wc);
  }

  /** Opens the main window where the last one was, and keeps track as it moves. */
  keepPlace(store: MainWindowStore) {
    this.place = store;
  }

  create() {
    // Hidden while Relay sat in the menubar alone.
    if (process.platform === "darwin") void app.dock?.show();
    const saved = this.place?.load();
    const win = this.build(
      {
        ...(saved
          ? placeOnScreen(
              saved.bounds,
              screen.getAllDisplays().map((d) => d.workArea),
              screen.getPrimaryDisplay().workArea,
            )
          : { width: 1500, height: 960 }),
        // A window saved narrow, its sidebar hidden, opens at its own width;
        // holdMinWidth raises this once it is as wide as the sidebar needs.
        minWidth: MAIN_MIN_WIDTH.alone,
        minHeight: 650,
      },
      () => {
        this.closingToQuit = false;
        this.hooks.quitCancelled();
      },
    );
    this.win = win;
    this.holdMinWidth(win);
    win.on("resize", () => this.holdMinWidth(win));
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
    win.once("ready-to-show", () => {
      if (saved?.maximized) win.maximize();
      this.show();
      if (saved?.fullScreen) win.setFullScreen(true);
      // Only from here on: before, it would save the size it was built with.
      for (const event of [
        "resize",
        "move",
        "maximize",
        "unmaximize",
        "enter-full-screen",
        "leave-full-screen",
      ] as const)
        win.on(event as "resize", () => this.savePlaceSoon(win));
      win.on("close", () => this.savePlace(win));
    });
    void loadPage(win);
  }

  private savePlaceSoon(win: BrowserWindow) {
    clearTimeout(this.placing);
    this.placing = setTimeout(() => this.savePlace(win), 500);
  }

  private savePlace(win: BrowserWindow) {
    clearTimeout(this.placing);
    if (!this.place || win.isDestroyed()) return;
    this.place.save({
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
    });
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
      backgroundColor:
        this.clear && process.platform === "darwin"
          ? "#00000000"
          : nativeTheme.shouldUseDarkColors
            ? "#202124"
            : "#f6f6f6",
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 20, y: 19 },
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
    // The page's errors land in main.log too, so a report after a blank
    // window says what broke. Capped: a render loop can throw every frame.
    let pageErrors = 0;
    win.webContents.on("console-message", (details) => {
      if (details.level !== "error" || pageErrors > pageErrorLimit) return;
      pageErrors++;
      const where = `${details.sourceId.split(/[\\/]/).pop()}:${details.lineNumber}`;
      console.warn(
        pageErrors > pageErrorLimit
          ? "Window error: over 100 in this window; the rest aren't logged"
          : `Window error: ${details.message.slice(0, 4000)} (${where})`,
      );
    });
    // The renderer's caption buttons swap maximize for restore.
    const sendMaximized = () =>
      win.webContents.send("relay:maximized", win.isMaximized());
    win.on("maximize", sendMaximized);
    win.on("unmaximize", sendMaximized);
    // macOS hides the traffic lights in full screen, so the titlebar drops their gap.
    const sendFullScreen = () =>
      win.webContents.send("relay:full-screen", win.isFullScreen());
    win.on("enter-full-screen", sendFullScreen);
    win.on("leave-full-screen", sendFullScreen);
    win.webContents.on("did-finish-load", sendFullScreen);
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
