// Relay lives in the menubar: closing the window leaves it running there,
// with its agents, and the icon brings the window back. Quit lives here too.
import { Menu, nativeImage, Tray } from "electron";
import { join } from "node:path";

export interface TrayStatus {
  /** Threads with an agent answering now. */
  working: number;
  /** Threads waiting on the user. */
  waiting: number;
}

export class RelayTray {
  private tray?: Tray;
  private status: TrayStatus = { working: 0, waiting: 0 };

  constructor(private actions: { open: () => void; quit: () => void }) {}

  start() {
    if (this.tray) return;
    const mac = process.platform === "darwin";
    // macOS tints a template image for light and dark menubars; elsewhere the app icon reads on any panel.
    // Beside the bundle, in dist-electron's parent: the app's own folder or its asar.
    const icon = nativeImage.createFromPath(
      join(__dirname, "..", "assets", mac ? "trayTemplate.png" : "icon.png"),
    );
    if (mac) icon.setTemplateImage(true);
    this.tray = new Tray(mac ? icon : icon.resize({ width: 22, height: 22 }));
    // Linux panels often send no clicks, only open the menu; there the menu leads with Open.
    if (process.platform === "linux") this.tray.setContextMenu(this.menu());
    else {
      this.tray.on("click", () => this.actions.open());
      this.tray.on("right-click", () =>
        this.tray?.popUpContextMenu(this.menu()),
      );
    }
    this.render();
  }

  update(status: TrayStatus) {
    if (
      status.working === this.status.working &&
      status.waiting === this.status.waiting
    )
      return;
    this.status = status;
    this.render();
  }

  destroy() {
    this.tray?.destroy();
    this.tray = undefined;
  }

  private summary() {
    const { working, waiting } = this.status;
    const parts = [
      working && `${working} ${working === 1 ? "thread" : "threads"} working`,
      waiting && `${waiting} waiting on you`,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Nothing running";
  }

  private render() {
    if (!this.tray) return;
    this.tray.setToolTip(`Relay · ${this.summary()}`);
    // A plain count beside the icon while agents work; nothing when idle.
    if (process.platform === "darwin")
      this.tray.setTitle(
        this.status.working ? String(this.status.working) : "",
        {
          fontType: "monospacedDigit",
        },
      );
    if (process.platform === "linux") this.tray.setContextMenu(this.menu());
  }

  private menu() {
    return Menu.buildFromTemplate([
      { label: this.summary(), enabled: false },
      { type: "separator" },
      { label: "Open Relay", click: () => this.actions.open() },
      { type: "separator" },
      { label: "Quit Relay", click: () => this.actions.quit() },
    ]);
  }
}
