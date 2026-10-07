import {
  BrowserWindow,
  session,
  WebContentsView,
  type NavigationEntry,
  type Session,
} from "electron";
import type {
  ConsoleEntry,
  DevServerState,
  PreviewAction,
  PreviewBounds,
  PreviewState,
} from "../../shared/preview";
import type { AppWindow } from "../app/window";
import { copyCookies } from "./cookies";
import { DevServers } from "./dev-servers";

/** Where a thread's preview runs and what it loads. */
export interface PreviewTarget {
  key: string;
  /** The thread's folder: its worktree, or the project's checkout. */
  folder: string;
  /** Its worktree's name; unset in the checkout. */
  worktree?: string;
  /** The partition the checkout's previews share. */
  checkoutPartition: string;
  /** Its own partition in a worktree, seeded from the checkout's. */
  partition: string;
  env: Record<string, string>;
  /** The project's dev command and port, the port already moved by the worktree's offset. */
  dev?: { command?: string; port: number };
}

interface Preview {
  target: PreviewTarget;
  /** Unset while unloaded; `parked` holds where it was. */
  view?: WebContentsView;
  parked?: { entries: NavigationEntry[]; index: number };
  /** A parked history is loading back in; the dev server's home must not replace it. */
  restoring?: boolean;
  shown: boolean;
  /** When it last left the panel. */
  hiddenAt: number;
  popOut?: BrowserWindow;
  error?: string;
  server: DevServerState;
  console: ConsoleEntry[];
  snapshot?: string;
  /** Counts place calls, so a hide still capturing knows it was overtaken. */
  placed: number;
}

const KEPT_CONSOLE = 200;
/** A preview out of sight this long gives its page's memory back. */
const UNLOAD_MS =
  (process.env.RELAY_TEST_DATA &&
    Number(process.env.RELAY_TEST_PREVIEW_UNLOAD_MS)) ||
  5 * 60_000;
const prepared = new WeakSet<Session>();

const webUrl = (url: string) => {
  const parsed = URL.parse(url);
  return parsed?.protocol === "http:" || parsed?.protocol === "https:";
};

/** Pages in a preview ask for nothing but the clipboard and full screen. */
function prepare(ses: Session) {
  if (prepared.has(ses)) return;
  prepared.add(ses);
  const allowed = new Set(["clipboard-sanitized-write", "fullscreen"]);
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(allowed.has(permission)),
  );
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

/**
 * Each thread's preview: a browser view laid over the panel. Native views
 * float above the page, so the panel shows it only while nothing covers it.
 */
export class ThreadPreviews {
  private previews = new Map<string, Preview>();
  readonly servers = new DevServers((folder, state) => {
    for (const preview of this.previews.values())
      if (preview.target.folder === folder) {
        preview.server = state;
        if (state.state === "running" && preview.target.dev?.port === state.port)
          this.loadDefault(preview);
        this.emit(preview);
      }
  });

  private sweep: NodeJS.Timeout;

  constructor(
    private window: AppWindow,
    private resolve: (projectId: string, chatId: string | null) => Promise<PreviewTarget>,
    private now = Date.now,
  ) {
    this.sweep = setInterval(() => this.unloadIdle(), Math.min(60_000, UNLOAD_MS));
    this.sweep.unref();
  }

  async open(projectId: string, chatId: string | null) {
    const target = await this.resolve(projectId, chatId);
    let preview = this.previews.get(target.key);
    if (preview && preview.target.folder !== target.folder) {
      // The thread moved to a worktree: a fresh browser in its own partition.
      this.close(target.key);
      preview = undefined;
    }
    if (!preview) preview = await this.create(target);
    else preview.target = target;
    this.revive(preview);
    this.wake(preview);
    return this.state(preview);
  }

  /** Starts the dev server if it isn't up, and loads its page once it is. */
  private wake(preview: Preview) {
    const { dev, folder, env } = preview.target;
    if (dev?.command) {
      const known = this.servers.state(folder);
      if (
        !known ||
        known.state === "failed" ||
        known.state === "asleep" ||
        ("port" in known && known.port !== dev.port)
      ) {
        preview.server = { state: "starting", port: dev.port };
        void this.servers.ensure(folder, dev.command, dev.port, env);
      } else preview.server = known;
      if (preview.server.state === "running") this.loadDefault(preview);
    } else if (dev) {
      preview.server = { state: "none" };
      this.loadDefault(preview);
    }
  }

  private async create(target: PreviewTarget): Promise<Preview> {
    const ses = session.fromPartition(target.partition);
    prepare(ses);
    if (target.partition !== target.checkoutPartition) {
      const checkout = session.fromPartition(target.checkoutPartition);
      if (!(await ses.cookies.get({})).length)
        await copyCookies(checkout, ses).catch((e) =>
          console.warn("Copying the checkout's cookies failed:", e),
        );
    }
    const preview: Preview = {
      target,
      shown: false,
      hiddenAt: this.now(),
      server: { state: "none" },
      console: [],
      placed: 0,
    };
    this.previews.set(target.key, preview);
    this.mount(preview);
    return preview;
  }

  /** A browser view for the preview, in its partition, so cookies outlive it. */
  private mount(preview: Preview) {
    const view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(preview.target.partition),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    view.setBackgroundColor("#ffffff");
    preview.view = view;
    const wc = view.webContents;
    // An unloaded page's last events mustn't speak for the next one.
    const current = () => preview.view?.webContents === wc;
    const emit = () => {
      if (current()) this.emit(preview);
    };
    wc.setWindowOpenHandler(({ url }) => {
      // One browser per thread: links that open a window open here.
      if (webUrl(url)) void wc.loadURL(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (e) => {
      if (!webUrl(e.url)) e.preventDefault();
    });
    wc.on("did-start-loading", () => {
      preview.error = undefined;
      emit();
    });
    wc.on("did-stop-loading", emit);
    wc.on("did-navigate", emit);
    wc.on("did-navigate-in-page", emit);
    wc.on("page-title-updated", emit);
    wc.on("did-fail-load", (_e, code, description, url, mainFrame) => {
      // -3 is a load another one replaced.
      if (!mainFrame || code === -3 || !current()) return;
      preview.error = `${description} (${url})`;
      emit();
    });
    wc.on("render-process-gone", (_e, details) => {
      if (!current()) return;
      preview.error = `The page stopped: ${details.reason}.`;
      emit();
    });
    wc.on("console-message", ({ level, message, sourceId, lineNumber }) => {
      if (level !== "error" && level !== "warning") return;
      preview.console.push({
        level,
        message,
        source: sourceId ? `${sourceId}:${lineNumber}` : undefined,
        at: Date.now(),
      });
      if (preview.console.length > KEPT_CONSOLE) preview.console.shift();
    });
    return wc;
  }

  /** The live page, loading an unloaded one back where it was. */
  private revive(preview: Preview) {
    if (preview.view) return preview.view.webContents;
    const parked = preview.parked;
    preview.parked = undefined;
    const wc = this.mount(preview);
    if (parked?.entries.length) {
      // Back, forward, scroll and form fields come back with it.
      preview.restoring = true;
      void wc.navigationHistory
        .restore(parked)
        .catch(() => {})
        .finally(() => {
          preview.restoring = false;
          this.emit(preview);
        });
    }
    return wc;
  }

  /** Previews out of sight for a while drop their page, keeping where it was. */
  unloadIdle() {
    for (const preview of this.previews.values()) {
      const wc = preview.view?.webContents;
      if (
        !wc ||
        preview.shown ||
        preview.popOut ||
        this.now() - preview.hiddenAt < UNLOAD_MS ||
        (!wc.isDestroyed() && wc.isDevToolsOpened())
      )
        continue;
      if (!wc.isDestroyed()) {
        const history = wc.navigationHistory;
        preview.parked = {
          entries: history.getAllEntries(),
          index: history.getActiveIndex(),
        };
        wc.close();
      }
      preview.view = undefined;
      this.emit(preview);
    }
  }

  private loadDefault(preview: Preview) {
    const dev = preview.target.dev;
    const wc = preview.view?.webContents;
    if (!dev || !wc || wc.isDestroyed() || preview.restoring) return;
    const home = `http://localhost:${dev.port}/`;
    // Only an empty page or one that couldn't reach the server yet.
    const url = wc.getURL();
    if (url && !(preview.error && URL.parse(url)?.port === String(dev.port)))
      return;
    void wc.loadURL(url || home).catch(() => {});
  }

  /** Lays the preview over the panel, or takes it off when `bounds` is null. */
  place(key: string, bounds: PreviewBounds | null) {
    const preview = this.previews.get(key);
    const win = this.window.win;
    if (!preview || preview.popOut || !win) return;
    const call = ++preview.placed;
    if (!bounds) return void this.hideWithSnapshot(preview, call);
    this.revive(preview);
    const view = preview.view!;
    const zoom = win.webContents.getZoomFactor();
    view.setBounds({
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.max(0, Math.round(bounds.width * zoom)),
      height: Math.max(0, Math.round(bounds.height * zoom)),
    });
    if (preview.shown) return;
    // One at a time over the panel.
    for (const other of this.previews.values())
      if (other !== preview) this.hide(other);
    win.contentView.addChildView(view);
    preview.shown = true;
    if (preview.snapshot) {
      preview.snapshot = undefined;
      this.emit(preview);
    }
    this.servers.watch(preview.target.folder, true);
  }

  /**
   * Takes the page off, leaving the panel its last frame to show, so a menu
   * opening over it doesn't blank it.
   */
  private async hideWithSnapshot(preview: Preview, call: number) {
    if (!preview.shown) return;
    const wc = preview.view?.webContents;
    if (wc && !wc.isDestroyed() && wc.getURL()) {
      const frame = await wc.capturePage().catch(() => null);
      if (call !== preview.placed) return;
      if (frame && !frame.isEmpty())
        preview.snapshot = `data:image/jpeg;base64,${frame.toJPEG(70).toString("base64")}`;
    }
    this.hide(preview);
    this.emit(preview);
  }

  private hide(preview: Preview) {
    if (!preview.shown) return;
    preview.shown = false;
    preview.hiddenAt = this.now();
    this.servers.watch(preview.target.folder, false);
    const win = this.window.win;
    if (win && !win.isDestroyed() && preview.view)
      win.contentView.removeChildView(preview.view);
  }

  /** The window reloaded or closed: whatever the panel showed is gone. */
  hideAll() {
    for (const preview of this.previews.values()) this.hide(preview);
  }

  navigate(key: string, url: string) {
    const preview = this.previews.get(key);
    if (!preview || !webUrl(url)) return;
    void this.revive(preview).loadURL(url).catch(() => {});
  }

  act(key: string, action: PreviewAction) {
    const preview = this.previews.get(key);
    if (!preview) return;
    const wc = this.revive(preview);
    const history = wc.navigationHistory;
    switch (action) {
      case "back":
        if (history.canGoBack()) history.goBack();
        return;
      case "forward":
        if (history.canGoForward()) history.goForward();
        return;
      case "reload": {
        const server = preview.server.state;
        if (server === "failed" || server === "asleep") {
          this.wake(preview);
          this.emit(preview);
        } else if (wc.getURL()) wc.reload();
        else this.loadDefault(preview);
        return;
      }
      case "stop":
        wc.stop();
        return;
      case "devtools":
        wc.openDevTools({ mode: "detach" });
        return;
      case "popOut":
        return this.popOut(preview);
      case "bringBack":
        preview.popOut?.close();
        return;
    }
  }

  private popOut(preview: Preview) {
    if (preview.popOut) return preview.popOut.focus();
    this.hide(preview);
    const view = preview.view!;
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: this.title(preview),
      backgroundColor: "#ffffff",
    });
    win.removeMenu?.();
    const fit = () => {
      const { width, height } = win.getContentBounds();
      view.setBounds({ x: 0, y: 0, width, height });
    };
    win.contentView.addChildView(view);
    fit();
    win.on("resize", fit);
    preview.popOut = win;
    this.servers.watch(preview.target.folder, true);
    const retitle = () => {
      if (!win.isDestroyed()) win.setTitle(this.title(preview));
    };
    view.webContents.on("page-title-updated", retitle);
    win.on("closed", () => {
      view.webContents.off("page-title-updated", retitle);
      preview.popOut = undefined;
      preview.hiddenAt = this.now();
      this.servers.watch(preview.target.folder, false);
      // Back in the panel, hidden until it asks for it again.
      if (this.previews.get(preview.target.key) === preview) this.emit(preview);
    });
    this.emit(preview);
  }

  private title(preview: Preview) {
    const page = this.page(preview).title || "Preview";
    return preview.target.worktree ? `[${preview.target.worktree}] ${page}` : page;
  }

  close(key: string) {
    const preview = this.previews.get(key);
    if (!preview) return;
    this.previews.delete(key);
    this.hide(preview);
    preview.popOut?.close();
    const wc = preview.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.close();
  }

  /** The page as a PNG, as the panel shows it; null without one. */
  async screenshot(key: string) {
    const preview = this.previews.get(key);
    const wc = preview?.view?.webContents;
    if (!wc || wc.isDestroyed() || !wc.getURL()) return null;
    return (await wc.capturePage()).toPNG();
  }

  consoleErrors(key: string) {
    return this.previews.get(key)?.console ?? null;
  }

  dispose() {
    clearInterval(this.sweep);
    for (const key of [...this.previews.keys()]) this.close(key);
    this.servers.dispose();
  }

  /** Where the page is, live or parked. */
  private page(preview: Preview) {
    const wc = preview.view?.webContents;
    if (wc && !wc.isDestroyed())
      return {
        url: wc.getURL(),
        title: wc.getTitle(),
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      };
    const { entries = [], index = 0 } = preview.parked ?? {};
    return {
      url: entries[index]?.url ?? "",
      title: entries[index]?.title ?? "",
      loading: false,
      canGoBack: index > 0,
      canGoForward: index < entries.length - 1,
    };
  }

  private state(preview: Preview): PreviewState {
    return {
      key: preview.target.key,
      ...this.page(preview),
      ...(preview.error ? { error: preview.error } : {}),
      ...(preview.snapshot ? { snapshot: preview.snapshot } : {}),
      poppedOut: !!preview.popOut,
      server: preview.server,
      ...(preview.target.worktree ? { worktree: preview.target.worktree } : {}),
    };
  }

  private emit(preview: Preview) {
    this.window.send("relay:preview", this.state(preview));
  }
}
