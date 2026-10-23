import {
  BrowserWindow,
  session,
  shell,
  WebContentsView,
  type NativeImage,
  type NavigationEntry,
  type Session,
} from "electron";
import type {
  ConsoleEntry,
  DevServerState,
  PreviewAction,
  PreviewAnnotationChange,
  PreviewBounds,
  PreviewState,
} from "../../shared/preview";
import type { AppWindow } from "../app/window";
import { copyCookies } from "./cookies";
import { DevServers } from "./dev-servers";
import type { BrowserAnnotation } from "../../shared/browser-annotations";
import { pickElement } from "./element-pick";
import { localPort } from "./local-urls";
import type { SavedPreview, SavedPreviews } from "./saved-previews";
import { sleep } from "../util/sleep";

/** Where a thread's preview runs and what it loads. */
export interface PreviewTarget {
  key: string;
  projectId: string;
  chatId: string | null;
  /** The thread's folder: its worktree, or the project's checkout. */
  folder: string;
  project: string;
  branch?: string;
  /** Its worktree's name; unset in the checkout. */
  worktree?: string;
  /** The checkout's browser, used to seed a thread on its first open. */
  checkoutPartition: string;
  /** Every thread owns a partition, seeded from the checkout's. */
  partition: string;
  env: Record<string, string>;
  url?: string;
  settings?: SavedPreview["settings"];
  /** The project's dev command and port, the port already moved by the worktree's offset. */
  dev?: { command?: string; port: number };
}

interface Preview {
  target: PreviewTarget;
  /** An explicit endpoint survives reopening the Browser tab. */
  selectedUrl?: string;
  /** A requested page waits for its server before it loads. */
  pendingUrl?: string;
  /** Unset while unloaded; `parked` holds where it was. */
  view?: WebContentsView;
  parked?: { entries: NavigationEntry[]; index: number };
  /** A parked history is loading back in; the dev server's home must not replace it. */
  restoring?: boolean;
  shown: boolean;
  /** Its view was in a window once, so it can be captured off screen. */
  drawn?: boolean;
  /** Ends an element pick under way. */
  stopPick?: () => void;
  /** When it last left the panel. */
  hiddenAt: number;
  /** The Relay window it's laid over while shown: the main one, or its thread's own. */
  host?: BrowserWindow;
  popOut?: BrowserWindow;
  error?: string;
  server: DevServerState;
  console: ConsoleEntry[];
  snapshot?: string;
  favicon?: string;
  faviconRequest?: object;
  /** Counts place calls, so a hide still capturing knows it was overtaken. */
  placed: number;
}

const KEPT_CONSOLE = 200;
/** What an agent's screenshot of a preview never shown is taken at. */
const UNSHOWN_SIZE = { width: 1280, height: 800 };
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
  private opening = new Map<
    string,
    { result: Promise<PreviewState>; controller: AbortController }
  >();
  readonly servers = new DevServers((folder, state) => {
    for (const preview of this.previews.values())
      if (
        preview.target.folder === folder &&
        preview.target.dev?.port === ("port" in state ? state.port : undefined)
      ) {
        preview.server = state;
        if (state.state === "running") this.loadDefault(preview);
        this.emit(preview);
      }
  });

  private sweep: NodeJS.Timeout;

  constructor(
    private window: AppWindow,
    private resolve: (
      projectId: string,
      chatId: string | null,
      url?: string,
      preferredFolder?: string,
      saved?: SavedPreview,
    ) => Promise<PreviewTarget>,
    private now = Date.now,
    private saved?: SavedPreviews,
  ) {
    this.sweep = setInterval(
      () => this.unloadIdle(),
      Math.min(60_000, UNLOAD_MS),
    );
    this.sweep.unref();
  }

  open(
    projectId: string,
    chatId: string | null,
    url?: string,
    command?: string,
  ) {
    const key = chatId ?? `draft:${projectId}`;
    const pending = this.opening.get(key);
    const controller = pending?.controller ?? new AbortController();
    const result = (pending?.result ?? Promise.resolve())
      .catch(() => {})
      .then(() =>
        this.openThread(projectId, chatId, url, controller.signal, command),
      );
    const entry = { result, controller };
    this.opening.set(key, entry);
    const clear = () => {
      if (this.opening.get(key) === entry) this.opening.delete(key);
    };
    void result.then(clear, clear);
    return result;
  }

  private async openThread(
    projectId: string,
    chatId: string | null,
    url: string | undefined,
    signal: AbortSignal,
    command?: string,
  ) {
    signal.throwIfAborted();
    const previous = this.previews.get(chatId ?? `draft:${projectId}`);
    const remembered = this.saved?.get(
      projectId,
      chatId ?? `draft:${projectId}`,
    );
    const selection = url ?? previous?.selectedUrl ?? remembered?.url;
    const requestedPort = localPort(url ?? "");
    const sameServer =
      requestedPort &&
      requestedPort ===
        localPort(previous?.selectedUrl ?? remembered?.url ?? "");
    const target = await this.resolve(
      projectId,
      chatId,
      selection,
      !url || sameServer
        ? (previous?.target.folder ?? remembered?.folder)
        : undefined,
      remembered,
    );
    signal.throwIfAborted();
    if (command !== undefined) {
      if (!target.dev || !localPort(target.url ?? selection ?? ""))
        throw new Error(
          "Open a localhost address before saving its dev command.",
        );
      if (!command.trim())
        throw new Error("Enter a dev command to start this preview.");
      target.dev.command = command.trim();
    }
    let preview = this.previews.get(target.key);
    if (preview && preview.target.folder !== target.folder) {
      // The thread moved to a worktree: a fresh browser in its own partition.
      this.remove(preview);
      preview = undefined;
    }
    if (!preview) preview = await this.create(target, signal);
    else preview.target = target;
    const destination = target.url ?? selection;
    if (destination && webUrl(destination)) {
      preview.selectedUrl = destination;
      if (url || destination !== selection || !this.page(preview).url)
        preview.pendingUrl = destination;
    }
    this.remember(preview);
    this.revive(preview);
    this.wake(preview);
    signal.throwIfAborted();
    return this.state(preview);
  }

  /** Starts the dev server if it isn't up, and loads its page once it is. */
  private wake(preview: Preview) {
    const { dev, folder, env } = preview.target;
    if (dev?.command) {
      // Owned children are cheap to reuse; external listeners must be rechecked.
      void this.servers
        .ensure(folder, dev.command, dev.port, env)
        .catch((error: Error) => {
          if (
            this.previews.get(preview.target.key) !== preview ||
            preview.target.dev?.port !== dev.port
          )
            return;
          preview.server = {
            state: "failed",
            port: dev.port,
            output: error.message,
          };
          this.emit(preview);
        });
      preview.server = this.servers.state(folder) ?? {
        state: "starting",
        port: dev.port,
      };
      if (preview.server.state === "running") this.loadDefault(preview);
    } else {
      preview.server = { state: "none" };
      this.loadDefault(preview);
    }
  }

  private async create(
    target: PreviewTarget,
    signal: AbortSignal,
  ): Promise<Preview> {
    const ses = session.fromPartition(target.partition);
    prepare(ses);
    if (target.partition !== target.checkoutPartition) {
      const checkout = session.fromPartition(target.checkoutPartition);
      if (!(await ses.cookies.get({})).length)
        await copyCookies(checkout, ses).catch((e) =>
          console.warn("Copying the checkout's cookies failed:", e),
        );
    }
    signal.throwIfAborted();
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
    preview.drawn = false;
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
    wc.on("did-start-navigation", ({ isSameDocument, isMainFrame }) => {
      if (!isMainFrame || isSameDocument || !current()) return;
      preview.favicon = undefined;
      preview.faviconRequest = undefined;
      emit();
    });
    wc.on("page-favicon-updated", (_event, urls) => {
      if (!current()) return;
      const request = {};
      preview.faviconRequest = request;
      void (async () => {
        let favicon: string | undefined;
        for (const url of urls) {
          if (!webUrl(url) && !url.startsWith("data:image/")) continue;
          try {
            const response = await wc.session.fetch(url);
            if (!response.ok) continue;
            const mime = response.headers.get("content-type")?.split(";")[0];
            if (!mime?.startsWith("image/")) continue;
            const bytes = Buffer.from(await response.arrayBuffer());
            if (!bytes.length || bytes.length > 1024 * 1024) continue;
            favicon = `data:${mime};base64,${bytes.toString("base64")}`;
            break;
          } catch {
            // Missing icons should never stop a page from loading.
          }
        }
        if (!current() || preview.faviconRequest !== request) return;
        preview.favicon = favicon;
        emit();
      })();
    });
    const navigated = () => {
      if (!current()) return;
      const url = wc.getURL();
      if (webUrl(url)) {
        preview.selectedUrl = url;
        this.remember(preview);
      }
      emit();
    };
    wc.on("did-navigate", navigated);
    wc.on("did-navigate-in-page", navigated);
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
      // Electron's own warnings (an unpackaged build's CSP nag) aren't the page's.
      if (sourceId.startsWith("node:electron/")) return;
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

  /** The dev server's page, when the project names its port. */
  home(key: string) {
    const dev = this.previews.get(key)?.target.dev;
    return dev && `http://localhost:${dev.port}/`;
  }

  private loadDefault(preview: Preview) {
    const dev = preview.target.dev;
    const wc = preview.view?.webContents;
    if (!wc || wc.isDestroyed() || preview.restoring) return;
    const home = dev && `http://localhost:${dev.port}/`;
    // Only an empty page or one that couldn't reach the server yet.
    const url = wc.getURL();
    if (
      !preview.pendingUrl &&
      url &&
      !(preview.error && localPort(url) === dev?.port)
    )
      return;
    const destination =
      preview.pendingUrl || url || preview.selectedUrl || home;
    if (!destination) return;
    preview.pendingUrl = undefined;
    preview.selectedUrl = destination;
    this.remember(preview);
    void wc.loadURL(destination).catch(() => {});
  }

  private remember(preview: Preview) {
    const { target } = preview;
    const url =
      preview.pendingUrl || preview.selectedUrl || this.page(preview).url;
    if (!url || !webUrl(url)) return;
    void this.saved
      ?.set(target.key, {
        projectId: target.projectId,
        folder: target.folder,
        url,
        ...(target.dev ? { dev: target.dev } : {}),
        settings: target.settings ?? {},
      })
      .catch((error) => console.warn("Could not save the preview:", error));
  }

  /** Lays the preview over the panel, or takes it off when `bounds` is null. */
  place(key: string, bounds: PreviewBounds | null) {
    const preview = this.previews.get(key);
    const win = this.window.hostFor(key);
    if (!preview || preview.popOut || !win) return;
    const call = ++preview.placed;
    if (!bounds) return void this.hideWithSnapshot(preview, call);
    // Its thread moved to another window since it was laid out.
    if (preview.host && preview.host !== win) this.hide(preview);
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
    // One at a time over each window's panel.
    for (const other of this.previews.values())
      if (other !== preview && other.host === win) this.hide(other);
    win.contentView.addChildView(view);
    preview.host = win;
    preview.shown = preview.drawn = true;
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
    preview.stopPick?.();
    this.servers.watch(preview.target.folder, false);
    const win = preview.host;
    preview.host = undefined;
    if (win && !win.isDestroyed() && preview.view)
      win.contentView.removeChildView(preview.view);
  }

  /** `win` reloaded or closed: whatever its panel showed is gone. */
  hideAll(win?: BrowserWindow) {
    for (const preview of this.previews.values())
      if (!win || preview.host === win) this.hide(preview);
  }

  async navigate(
    projectId: string,
    chatId: string | null,
    url: string,
    command?: string,
  ) {
    if (!webUrl(url)) return;
    await this.open(projectId, chatId, url, command);
  }

  act(key: string, action: PreviewAction) {
    const preview = this.previews.get(key);
    if (!preview) return;
    if (action === "openExternal") return this.openExternal(preview);
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
        const server = this.state(preview).server.state;
        if (server === "failed" || server === "asleep") {
          this.wake(preview);
          this.emit(preview);
        } else if (preview.error && preview.target.dev?.command) {
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
      case "stopPicking":
        preview.stopPick?.();
        return;
    }
  }

  private async openExternal(preview: Preview) {
    const url = this.page(preview).url;
    if (url && webUrl(url)) await shell.openExternal(url);
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
    preview.drawn = true;
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
    return preview.target.worktree
      ? `[${preview.target.worktree}] ${page}`
      : page;
  }

  close(key: string) {
    this.opening.get(key)?.controller.abort();
    this.opening.delete(key);
    const preview = this.previews.get(key);
    if (!preview) return;
    this.remove(preview);
  }

  private remove(preview: Preview) {
    this.previews.delete(preview.target.key);
    this.hide(preview);
    preview.popOut?.close();
    const wc = preview.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.close();
  }

  /** Where the preview is now; undefined before it was opened. */
  current(key: string) {
    const preview = this.previews.get(key);
    return preview && this.state(preview);
  }

  /** Tells the window a thread's preview was opened for it, to give it a tab. */
  reveal(projectId: string, chatId: string) {
    this.window.send("relay:preview-reveal", { projectId, chatId });
  }

  /** Resolves once the server started (or gave up) and the page stopped loading. */
  async settled(key: string, timeoutMs: number, signal?: AbortSignal) {
    const end = this.now() + timeoutMs;
    // A load just asked for may not have begun yet.
    await sleep(150);
    while (!signal?.aborted && this.now() < end) {
      const preview = this.previews.get(key);
      if (!preview) return;
      const wc = preview.view?.webContents;
      if (
        this.state(preview).server.state !== "starting" &&
        !preview.restoring &&
        !(wc && !wc.isDestroyed() && wc.isLoading())
      )
        return;
      await sleep(150);
    }
  }

  /**
   * The page as it looks now, also while it's off screen: then at the size
   * the panel last gave it. Null without a page.
   */
  async capture(key: string): Promise<NativeImage | null> {
    const preview = this.previews.get(key);
    if (!preview) return null;
    const wc = this.revive(preview);
    await this.settled(key, 15_000);
    if (preview.view?.webContents !== wc || wc.isDestroyed() || !wc.getURL())
      return null;
    const view = preview.view!;
    if (!preview.shown && !preview.popOut) {
      const { width, height } = view.getBounds();
      if (!width || !height) view.setBounds({ x: 0, y: 0, ...UNSHOWN_SIZE });
      if (!preview.drawn) await this.prime(preview);
    }
    // Chromium has no frame for a view just taken off a window at first.
    for (let attempt = 1; ; attempt++) {
      const image = await wc.capturePage().catch(() => null);
      if (image && !image.isEmpty()) return image;
      if (attempt === 10) throw new Error("The preview could not be drawn.");
      if (attempt === 4 && !preview.shown && !preview.popOut)
        await this.prime(preview);
      await sleep(100);
    }
  }

  /** Gives a view never shown a surface: a moment in the window, outside what it shows. */
  private async prime(preview: Preview) {
    const win = this.window.hostFor(preview.target.key);
    const view = preview.view;
    if (!win || win.isDestroyed() || !view)
      throw new Error(
        "Relay's window is closed, so the preview can't be drawn.",
      );
    const bounds = view.getBounds();
    view.setBounds({ ...bounds, x: 100_000, y: 0 });
    win.contentView.addChildView(view, 0);
    await sleep(50);
    // The panel may have asked for it meanwhile.
    if (preview.view !== view || preview.shown || preview.popOut) return;
    win.contentView.removeChildView(view);
    view.setBounds(bounds);
    preview.drawn = true;
  }

  /** The page's errors and warnings, oldest first; `clear` empties the list after. */
  consoleErrors(key: string, clear = false) {
    const preview = this.previews.get(key);
    if (!preview) return null;
    const entries = [...preview.console];
    if (clear) preview.console = [];
    return entries;
  }

  /**
   * Lets the user inspect the page and write feedback beside an element;
   * null when they cancel or the preview goes away.
   */
  async pick(
    key: string,
    annotations: BrowserAnnotation[],
    available: number,
  ): Promise<PreviewAnnotationChange | null> {
    const preview = this.previews.get(key);
    const wc = preview?.view?.webContents;
    if (!preview || !wc || wc.isDestroyed() || !wc.getURL()) return null;
    preview.stopPick?.();
    const picking = pickElement(wc, annotations, available);
    preview.stopPick = picking.cancel;
    this.emit(preview);
    try {
      return await picking.result;
    } finally {
      if (preview.stopPick === picking.cancel) preview.stopPick = undefined;
      this.emit(preview);
    }
  }

  /** With `detach`, Relay is restarting and the dev servers the agent host runs carry on. */
  dispose({ detach = false } = {}) {
    clearInterval(this.sweep);
    for (const key of new Set([
      ...this.previews.keys(),
      ...this.opening.keys(),
    ]))
      this.close(key);
    if (detach) this.servers.detach();
    else this.servers.dispose();
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
    const page = this.page(preview);
    page.url = preview.pendingUrl || page.url || preview.selectedUrl || "";
    const server = preview.server;
    const dependsOnServer =
      !page.url || ("port" in server && localPort(page.url) === server.port);
    return {
      key: preview.target.key,
      ...page,
      ...(preview.favicon ? { favicon: preview.favicon } : {}),
      ...(preview.error ? { error: preview.error } : {}),
      ...(preview.snapshot ? { snapshot: preview.snapshot } : {}),
      poppedOut: !!preview.popOut,
      picking: !!preview.stopPick,
      server: dependsOnServer ? server : { state: "none" },
      ...(preview.target.worktree ? { worktree: preview.target.worktree } : {}),
    };
  }

  private emit(preview: Preview) {
    this.window.send("relay:preview", this.state(preview));
  }
}
