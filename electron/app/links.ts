import { app } from "electron";
import { roomProtocol } from "../../shared/rooms";
import type { AppWindow } from "./window";

function isAppUrl(url: string) {
  return (
    url.length <= 16384 &&
    (url.startsWith("relay:") || url.startsWith(roomProtocol + ":"))
  );
}

/** Relay links from the OS: a second launch, open-url, or the first launch's arguments. */
export class AppLinks {
  /** Kept until a signed-in window has taken it. */
  pending = process.argv.find(isAppUrl);

  constructor(
    private window: AppWindow,
    private signedIn: () => boolean,
  ) {}

  listen() {
    app.on("second-instance", (_event, args) => {
      const url = args.find(isAppUrl);
      if (url) this.receive(url);
      else this.window.open();
    });
    app.on("open-url", (e, url) => {
      e.preventDefault();
      this.receive(url);
    });
  }

  /** The link the window should open on load. */
  take() {
    const url = this.pending;
    if (this.signedIn()) this.pending = undefined;
    return url;
  }

  private receive(url: string) {
    if (!isAppUrl(url)) return;
    this.pending = url;
    const window = this.window;
    if (!window.win && window.ready) window.create();
    if (window.win) {
      window.show();
      if (!window.win.webContents.isLoading()) {
        if (this.signedIn()) this.pending = undefined;
        window.win.webContents.send("relay:open-url", url);
      }
    }
  }
}
