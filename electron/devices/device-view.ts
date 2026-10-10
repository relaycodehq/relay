import { session, shell, WebContentsView } from "electron";
import type { PreviewBounds } from "../../shared/preview";
import type { AppWindow } from "../app/window";
import type { RunningHub } from "./hub";

/** Hidden this long, the page closes, so it stops pulling frames. */
const UNLOAD_MS = 20_000;
/** Not persisted: the token, and so its cookie, change with every start. */
const PARTITION = "device-hub";

/**
 * The hub's page, laid over the Device tab. Native views draw above the
 * page, so the panel takes it off while anything covers it and shows its
 * last frame instead.
 */
export class DeviceView {
  private view?: WebContentsView;
  private hub?: RunningHub;
  /** The tab wants the page; it's only in the window once it has loaded. */
  private shown = false;
  private attached = false;
  private loaded = false;
  private placed = 0;
  private unload?: NodeJS.Timeout;
  snapshot?: string;

  constructor(
    private window: AppWindow,
    private changed: () => void,
  ) {
    const ses = session.fromPartition(PARTITION);
    const allowed = new Set(["clipboard-sanitized-write"]);
    ses.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(allowed.has(permission)),
    );
    ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  }

  private open(hub: RunningHub) {
    if (this.view && this.hub === hub && !this.view.webContents.isDestroyed())
      return this.view;
    this.destroy();
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
      },
    });
    const wc = view.webContents;
    // The hub's own links (docs, Expo) belong in the user's browser.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (event, url) => {
      if (URL.parse(url)?.origin === hub.origin) return;
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    });
    // Until the page paints, the tab keeps showing the last frame.
    const ready = () => {
      if (this.view !== view) return;
      this.loaded = true;
      this.attach();
    };
    wc.once("did-finish-load", ready);
    // -3 is a load another navigation replaced, not one that failed.
    wc.on("did-fail-load", (_e, code, _text, _url, mainFrame) => {
      if (mainFrame && code !== -3) ready();
    });
    // The link trades the token for a cookie and drops it from the address.
    void wc.loadURL(`${hub.origin}/?token=${hub.token}`).catch(() => {});
    this.view = view;
    this.hub = hub;
    this.loaded = false;
    return view;
  }

  /** Lays the page over the tab, or takes it off when `bounds` is null. */
  place(bounds: PreviewBounds | null, hub?: RunningHub) {
    const win = this.window.win;
    if (!win || win.isDestroyed()) return;
    const call = ++this.placed;
    if (!bounds || !hub) return void this.hideWithSnapshot(call);
    clearTimeout(this.unload);
    const view = this.open(hub);
    const zoom = win.webContents.getZoomFactor();
    view.setBounds({
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.max(0, Math.round(bounds.width * zoom)),
      height: Math.max(0, Math.round(bounds.height * zoom)),
    });
    this.shown = true;
    this.attach();
  }

  private attach() {
    const win = this.window.win;
    if (!this.shown || this.attached || !this.loaded || !this.view) return;
    if (!win || win.isDestroyed()) return;
    win.contentView.addChildView(this.view);
    this.attached = true;
    if (this.snapshot) {
      this.snapshot = undefined;
      this.changed();
    }
  }

  private async hideWithSnapshot(call: number) {
    if (!this.shown) return;
    const wc = this.view?.webContents;
    if (this.attached && wc && !wc.isDestroyed()) {
      const frame = await wc.capturePage().catch(() => null);
      if (call !== this.placed) return;
      if (frame && !frame.isEmpty())
        this.snapshot = `data:image/jpeg;base64,${frame.toJPEG(70).toString("base64")}`;
    }
    this.hide();
    this.changed();
  }

  /** The window reloaded or closed: whatever the panel showed is gone. */
  hide() {
    if (!this.shown) return;
    this.shown = false;
    const win = this.window.win;
    if (this.attached && win && !win.isDestroyed() && this.view)
      win.contentView.removeChildView(this.view);
    this.attached = false;
    clearTimeout(this.unload);
    this.unload = setTimeout(() => {
      if (!this.shown) this.destroy();
    }, UNLOAD_MS);
  }

  destroy() {
    clearTimeout(this.unload);
    this.hide();
    clearTimeout(this.unload);
    const view = this.view;
    this.view = this.hub = undefined;
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
  }
}
