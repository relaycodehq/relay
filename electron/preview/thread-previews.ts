import {
  BrowserWindow,
  session,
  WebContentsView,
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
  view: WebContentsView;
  shown: boolean;
  popOut?: BrowserWindow;
  error?: string;
  server: DevServerState;
  console: ConsoleEntry[];
  snapshot?: string;
  /** Counts place calls, so a hide still capturing knows it was overtaken. */
  placed: number;
}

const KEPT_CONSOLE = 200;
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

  constructor(
    private window: AppWindow,
    private resolve: (projectId: string, chatId: string | null) => Promise<PreviewTarget>,
  ) {}

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
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    view.setBackgroundColor("#ffffff");
    const preview: Preview = {
      target,
      view,
      shown: false,
      server: { state: "none" },
      console: [],
      placed: 0,
    };
    this.previews.set(target.key, preview);
    const wc = view.webContents;
    const emit = () => this.emit(preview);
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
      if (!mainFrame || code === -3) return;
      preview.error = `${description} (${url})`;
      emit();
    });
    wc.on("render-process-gone", (_e, details) => {
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
    return preview;
  }

  private loadDefault(preview: Preview) {
    const dev = preview.target.dev;
    const wc = preview.view.webContents;
    if (!dev || wc.isDestroyed()) return;
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
    const zoom = win.webContents.getZoomFactor();
    preview.view.setBounds({
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.max(0, Math.round(bounds.width * zoom)),
      height: Math.max(0, Math.round(bounds.height * zoom)),
    });
    if (preview.shown) return;
    // One at a time over the panel.
    for (const other of this.previews.values())
      if (other !== preview) this.hide(other);
    win.contentView.addChildView(preview.view);
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
    const wc = preview.view.webContents;
    if (wc.getURL() && !wc.isDestroyed()) {
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
    this.servers.watch(preview.target.folder, false);
    const win = this.window.win;
    if (win && !win.isDestroyed()) win.contentView.removeChildView(preview.view);
  }

  /** The window reloaded or closed: whatever the panel showed is gone. */
  hideAll() {
    for (const preview of this.previews.values()) this.hide(preview);
  }

  navigate(key: string, url: string) {
    const preview = this.previews.get(key);
    if (!preview || !webUrl(url)) return;
    void preview.view.webContents.loadURL(url).catch(() => {});
  }

  act(key: string, action: PreviewAction) {
    const preview = this.previews.get(key);
    if (!preview) return;
    const wc = preview.view.webContents;
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
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: this.title(preview),
      backgroundColor: "#ffffff",
    });
    win.removeMenu?.();
    const fit = () => {
      const { width, height } = win.getContentBounds();
      preview.view.setBounds({ x: 0, y: 0, width, height });
    };
    win.contentView.addChildView(preview.view);
    fit();
    win.on("resize", fit);
    preview.popOut = win;
    this.servers.watch(preview.target.folder, true);
    const retitle = () => {
      if (!win.isDestroyed()) win.setTitle(this.title(preview));
    };
    preview.view.webContents.on("page-title-updated", retitle);
    win.on("closed", () => {
      preview.view.webContents.off("page-title-updated", retitle);
      preview.popOut = undefined;
      this.servers.watch(preview.target.folder, false);
      // Back in the panel, hidden until it asks for it again.
      if (this.previews.get(preview.target.key) === preview) this.emit(preview);
    });
    this.emit(preview);
  }

  private title(preview: Preview) {
    const page = preview.view.webContents.getTitle() || "Preview";
    return preview.target.worktree ? `[${preview.target.worktree}] ${page}` : page;
  }

  close(key: string) {
    const preview = this.previews.get(key);
    if (!preview) return;
    this.previews.delete(key);
    this.hide(preview);
    preview.popOut?.close();
    if (!preview.view.webContents.isDestroyed()) preview.view.webContents.close();
  }

  /** The page as a PNG, as the panel shows it; null without one. */
  async screenshot(key: string) {
    const preview = this.previews.get(key);
    if (!preview || !preview.view.webContents.getURL()) return null;
    return (await preview.view.webContents.capturePage()).toPNG();
  }

  consoleErrors(key: string) {
    return this.previews.get(key)?.console ?? null;
  }

  dispose() {
    for (const key of [...this.previews.keys()]) this.close(key);
    this.servers.dispose();
  }

  private state(preview: Preview): PreviewState {
    const wc = preview.view.webContents;
    const destroyed = wc.isDestroyed();
    return {
      key: preview.target.key,
      url: destroyed ? "" : wc.getURL(),
      title: destroyed ? "" : wc.getTitle(),
      loading: !destroyed && wc.isLoading(),
      canGoBack: !destroyed && wc.navigationHistory.canGoBack(),
      canGoForward: !destroyed && wc.navigationHistory.canGoForward(),
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
