import type { BrowserWindow } from "electron";
import type { DeviceHubState } from "../../shared/devices";
import type { PreviewBounds } from "../../shared/preview";
import type { AppWindow } from "../app/window";
import { DeviceView } from "./device-view";
import { DeviceHub, type Fetch } from "./hub";

export { HUB_VERSION } from "./hub";

/** Simulators and emulators in the panel: the hub that streams them, and its page. */
export class Devices {
  private hub: DeviceHub;
  private view: DeviceView;
  /** Where each window's Device tab is on screen, while it is. */
  private wanted = new Map<BrowserWindow, PreviewBounds>();

  constructor(
    private window: AppWindow,
    dir: string,
    fetch: Fetch,
  ) {
    const changed = () => void this.emit();
    this.hub = new DeviceHub(dir, changed, fetch);
    this.view = new DeviceView(changed, () => void this.hub.sleep());
  }

  async state(): Promise<DeviceHubState> {
    return {
      ...(await this.hub.state()),
      ...(this.view.snapshot && { snapshot: this.view.snapshot }),
    };
  }

  private async emit() {
    this.window.send("relay:device-hub", await this.state());
  }

  async start() {
    await this.hub.start().catch(() => {});
    return this.state();
  }

  async place(bounds: PreviewBounds | null) {
    const win = this.window.caller();
    if (!win) return;
    if (bounds) this.wanted.set(win, bounds);
    else this.wanted.delete(win);
    await this.show(bounds ? win : undefined);
  }

  /**
   * Lays the one page over `preferred`, else where it lies if that tab still
   * shows, else over any other window showing the tab; with none, takes it
   * off. Only a running hub has a page. Showing wakes one that went to sleep
   * unwatched; the tab places the page again once it runs.
   */
  private async show(preferred?: BrowserWindow) {
    const host = this.view.host;
    const win =
      preferred ??
      (host && this.wanted.has(host) ? host : this.wanted.keys().next().value);
    if (!win) return void (host && this.view.place(host, null));
    const { status } = await this.hub.state();
    if (status === "asleep") void this.hub.start().catch(() => {});
    const running = status === "running" ? await this.hub.start() : undefined;
    this.view.place(win, this.wanted.get(win) ?? null, running);
  }

  /** A Device tab closed: the hub sleeps once no window shows one. */
  close() {
    const win = this.window.caller();
    if (win) this.wanted.delete(win);
    if (this.wanted.size) return this.show();
    this.view.destroy();
    return this.hub.sleep();
  }

  /** `win`'s page went: the hub's page goes with it if it lay over it. */
  hideAll(win: BrowserWindow) {
    this.wanted.delete(win);
    this.view.hideIn(win);
    void this.show();
  }

  dispose() {
    this.view.destroy();
    return this.hub.dispose();
  }
}
