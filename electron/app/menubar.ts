import { app } from "electron";
import { RelayTray } from "./tray";

/** The tray icon's counts: threads working, and threads waiting on the user. */
export class Menubar {
  private tray: RelayTray;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waiting = 0;

  constructor(
    open: () => void,
    private working: () => number,
  ) {
    this.tray = new RelayTray({ open, quit: () => app.quit() });
  }

  start() {
    this.tray.start();
  }

  destroy() {
    this.tray.destroy();
  }

  setWaiting(count: number) {
    this.waiting = count;
    this.refresh();
  }

  /** Chat events stream with every token; the menubar needs a count now and then. */
  refresh() {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.tray.update({ working: this.working(), waiting: this.waiting });
    }, 500);
  }
}
