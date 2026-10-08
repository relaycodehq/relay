import { app } from "electron";
import { launchFolder } from "./open-folder";
import type { AppWindow } from "./window";

function isAppUrl(url: string) {
  return url.length <= 16384 && url.startsWith("relay:");
}

/** A launch's own arguments: `electron .` in development puts the app's folder first. */
const launchArgs = (argv: string[]) => argv.slice(process.defaultApp ? 2 : 1);

/**
 * Relay links and folders from the OS: a second launch, open-url, open-file
 * (`relay .` and the Dock on macOS), or the first launch's arguments.
 */
export class AppLinks {
  /** Kept until a signed-in window has taken it. */
  pending = process.argv.find(isAppUrl);
  /** The project a folder opened, kept until the window has taken it. */
  pendingProject?: string;
  /** Folders that came before Relay could look them up. */
  private folders: string[] = [];
  private openFolder?: (folder: string) => void;

  constructor(
    private window: AppWindow,
    private signedIn: () => boolean,
  ) {}

  listen() {
    const first = launchFolder(launchArgs(process.argv), process.cwd());
    if (first) this.folders.push(first);
    app.on("second-instance", (_event, args, cwd) => {
      const url = args.find(isAppUrl);
      const folder = url ? undefined : launchFolder(launchArgs(args), cwd);
      if (url) this.receive(url);
      else if (folder) this.receiveFolder(folder);
      else this.window.open();
    });
    app.on("open-url", (e, url) => {
      e.preventDefault();
      this.receive(url);
    });
    // Before the app finishes launching, or a cold start's folder is lost.
    app.on("open-file", (e, path) => {
      e.preventDefault();
      this.receiveFolder(path);
    });
  }

  /** Looks folders up from now on, the ones that came already first. */
  onFolder(open: (folder: string) => void) {
    this.openFolder = open;
    for (const folder of this.folders.splice(0)) open(folder);
  }

  /** Shows `id`'s project, now or once the window loads. */
  openProject(id: string) {
    this.pendingProject = id;
    this.deliver("relay:open-project", id, () => {
      this.pendingProject = undefined;
    });
  }

  takeProject() {
    const id = this.pendingProject;
    this.pendingProject = undefined;
    return id;
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
    this.deliver("relay:open-url", url, () => {
      if (this.signedIn()) this.pending = undefined;
    });
  }

  private receiveFolder(folder: string) {
    if (this.openFolder) this.openFolder(folder);
    else this.folders.push(folder);
  }

  /** Brings the window up and sends `value`; a window still loading takes it from the bootstrap. */
  private deliver(channel: string, value: string, taken: () => void) {
    const window = this.window;
    if (!window.win && window.ready) window.create();
    if (window.win) {
      window.show();
      if (!window.win.webContents.isLoading()) {
        taken();
        window.win.webContents.send(channel, value);
      }
    }
  }
}
