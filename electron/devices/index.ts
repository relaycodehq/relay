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

  constructor(
    private window: AppWindow,
    dir: string,
    fetch: Fetch,
  ) {
    const changed = () => void this.emit();
    this.hub = new DeviceHub(dir, changed, fetch);
    this.view = new DeviceView(changed);
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

  /** Only a running hub has a page; placing one starts nothing. */
  async place(bounds: PreviewBounds | null) {
    const win = this.window.caller();
    const running =
      bounds && (await this.hub.state()).status === "running"
        ? await this.hub.start()
        : undefined;
    this.view.place(win, bounds, running);
  }

  close() {
    this.view.destroy();
  }

  /** `win`'s page went: the hub's page goes with it if it lay over it. */
  hideAll(win: BrowserWindow) {
    this.view.hideIn(win);
  }

  dispose() {
    this.view.destroy();
    return this.hub.dispose();
  }
}
