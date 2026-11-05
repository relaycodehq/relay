import {
  type BrowserWindow,
  session,
  shell,
  WebContentsView,
  type NativeImage,
} from "electron";
import type {
  PreviewAction,
  PreviewAnnotationChange,
  PreviewBounds,
  PreviewState,
} from "../../shared/preview";
import { pageKey, threadKeyOf } from "../../shared/preview";
import type { AppWindow } from "../app/window";
import { DevServers } from "./dev-servers";
import type { BrowserAnnotation } from "../../shared/browser-annotations";
import { pickElement } from "./element-pick";
import { localPort, webUrl } from "./local-urls";
import { keepConsole } from "./page-console";
import { followPage } from "./page-events";
import { browserKeys } from "./page-keys";
import { drawFrame } from "./off-screen";
import { popOutWindow } from "./pop-out";
import { preparePreviewSession } from "./preview-session";
import {
  pageOf,
  previewState,
  type Preview,
  type PreviewTarget,
} from "./preview-state";
import type { SavedPreview, SavedPreviews } from "./saved-previews";
import { sleep } from "../util/sleep";

/** A preview out of sight this long gives its page's memory back. */
const UNLOAD_MS =
  (process.env.RELAY_TEST_DATA &&
    Number(process.env.RELAY_TEST_PREVIEW_UNLOAD_MS)) ||
  5 * 60_000;

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
    {
      url,
      command,
      page,
    }: {
      url?: string;
      command?: string;
      /** Another page beside the thread's own. */
      page?: string;
    } = {},
  ) {
    const key = pageKey(chatId ?? `draft:${projectId}`, page);
    const pending = this.opening.get(key);
    const controller = pending?.controller ?? new AbortController();
    const result = (pending?.result ?? Promise.resolve())
      .catch(() => {})
      .then(() =>
        this.openPage(key, projectId, chatId, url, controller.signal, command),
      );
    const entry = { result, controller };
    this.opening.set(key, entry);
    const clear = () => {
      if (this.opening.get(key) === entry) this.opening.delete(key);
    };
    void result.then(clear, clear);
    return result;
  }

  private async openPage(
    key: string,
    projectId: string,
    chatId: string | null,
    url: string | undefined,
    signal: AbortSignal,
    command?: string,
  ) {
    signal.throwIfAborted();
    const previous = this.previews.get(key);
    const remembered = this.saved?.get(projectId, key);
    // A page opened beside the thread's own looks at the same server.
    const threadsFolder = this.previews.get(threadKeyOf(key))?.target.folder;
    const selection = url ?? previous?.selectedUrl ?? remembered?.url;
    const requestedPort = localPort(url ?? "");
    const sameServer =
      requestedPort &&
      requestedPort ===
        localPort(previous?.selectedUrl ?? remembered?.url ?? "");
    const resolved = await this.resolve(
      projectId,
      chatId,
      selection,
      !url || sameServer
        ? (previous?.target.folder ?? remembered?.folder ?? threadsFolder)
        : undefined,
      remembered,
    );
    const target = { ...resolved, key };
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
      if (url || destination !== selection || !pageOf(preview).url)
        preview.pendingUrl = destination;
    }
    this.remember(preview);
    this.revive(preview);
    this.wake(preview);
    signal.throwIfAborted();
    return previewState(preview);
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
    await preparePreviewSession(target);
    signal.throwIfAborted();
    const preview: Preview = {
      target,
      shown: false,
      hiddenAt: this.now(),
      capturing: 0,
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
    followPage(wc, preview, {
      current,
      changed: emit,
      navigated: (url) => {
        preview.selectedUrl = url;
        this.remember(preview);
      },
    });
    keepConsole(wc, preview);
    browserKeys(wc, {
      reload: () => {
        if (current()) this.act(preview.target.key, "reload");
      },
      newTab: () => {
        if (current()) this.askForNewTab(preview);
      },
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
        preview.capturing ||
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
      preview.pendingUrl || preview.selectedUrl || pageOf(preview).url;
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

  /**
   * The page has the keyboard, so Relay's window never hears the press: it
   * gets the keyboard back, to answer the panel's picker, and is told.
   */
  private askForNewTab(preview: Preview) {
    const win = this.hostFor(preview);
    if (win && !win.isDestroyed()) win.webContents.focus();
    this.window.send("relay:preview-new-tab", { key: preview.target.key });
  }

  /** The Relay window its thread is in: the main one, or the thread's own. */
  private hostFor(preview: Preview) {
    return this.window.hostFor(threadKeyOf(preview.target.key));
  }

  /** Lays the preview over the panel, or takes it off when `bounds` is null. */
  place(key: string, bounds: PreviewBounds | null) {
    const preview = this.previews.get(key);
    const win = preview && this.hostFor(preview);
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
    { command, page }: { command?: string; page?: string } = {},
  ) {
    if (!webUrl(url)) return;
    await this.open(projectId, chatId, { url, command, page });
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
        const server = previewState(preview).server.state;
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
    const url = pageOf(preview).url;
    if (url && webUrl(url)) await shell.openExternal(url);
  }

  private popOut(preview: Preview) {
    if (preview.popOut) return preview.popOut.focus();
    this.hide(preview);
    preview.popOut = popOutWindow(preview, {
      title: () => this.title(preview),
      closed: () => {
        preview.popOut = undefined;
        preview.hiddenAt = this.now();
        this.servers.watch(preview.target.folder, false);
        // Back in the panel, hidden until it asks for it again.
        if (this.previews.get(preview.target.key) === preview)
          this.emit(preview);
      },
    });
    this.servers.watch(preview.target.folder, true);
    this.emit(preview);
  }

  private title(preview: Preview) {
    const page = pageOf(preview).title || "Preview";
    return preview.target.worktree
      ? `[${preview.target.worktree}] ${page}`
      : page;
  }

  /**
   * Its tab was closed. A page beside the thread's own never opens again, so
   * its address goes; the thread's own keeps it for next time.
   */
  closeTab(key: string) {
    this.close(key);
    if (key === threadKeyOf(key)) return;
    void this.saved
      ?.forget(key)
      .catch((error) => console.warn("Could not forget the page:", error));
  }

  /** The thread was deleted: its pages close, and none is kept for next time. */
  async closeThread(chatId: string) {
    const keys = [...this.previews.keys(), ...this.opening.keys()];
    for (const key of new Set(keys))
      if (threadKeyOf(key) === chatId) this.close(key);
    await this.saved?.forgetThread(chatId);
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
    return preview && previewState(preview);
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
        previewState(preview).server.state !== "starting" &&
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
    preview.capturing++;
    try {
      const wc = this.revive(preview);
      await this.settled(key, 15_000);
      if (preview.view?.webContents !== wc || wc.isDestroyed() || !wc.getURL())
        return null;
      return await drawFrame(preview, wc, () => this.hostFor(preview));
    } finally {
      preview.capturing--;
    }
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
  ): Promise<PreviewAnnotationChange | null> {
    const preview = this.previews.get(key);
    const wc = preview?.view?.webContents;
    if (!preview || !wc || wc.isDestroyed() || !wc.getURL()) return null;
    preview.stopPick?.();
    const picking = pickElement(wc, annotations);
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

  private emit(preview: Preview) {
    this.window.send("relay:preview", previewState(preview));
  }
}
