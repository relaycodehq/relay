import { app } from "electron";
import { readFileSync, watchFile } from "node:fs";

/** Asks scripts/dev.mjs to write the new bundles and start Relay again. */
const RESTART = 75;

/**
 * Under `npm run dev`, scripts/dev.mjs rebuilds the main process's bundles
 * as their sources change and names the ones this run is behind in a file.
 * Relay offers a restart rather than quietly running yesterday's code.
 */
export class DevBuild {
  /** The bundles that changed since this run started, by name. */
  stale: string[] = [];
  private file = process.env.RELAY_DEV_STALE;

  constructor(
    private changed: (stale: string[]) => void,
    private hooks: { beforeQuit: () => void },
  ) {}

  start() {
    const file = this.file;
    if (!file) return;
    // Polled: the file comes and goes, which fs.watch can't follow.
    watchFile(file, { interval: 1000 }, () => {
      const stale = read(file);
      if (stale.join() === this.stale.join()) return;
      this.stale = stale;
      this.changed(stale);
    });
    this.stale = read(file);
  }

  /** Quits like a restart for an update: the agents' sessions carry on. */
  restart() {
    if (!this.file) return;
    this.hooks.beforeQuit();
    app.once("will-quit", (event) => {
      event.preventDefault();
      app.exit(RESTART);
    });
    app.quit();
  }
}

function read(file: string): string[] {
  try {
    const names: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(names)
      ? names.filter((n) => typeof n === "string")
      : [];
  } catch {
    // No file: nothing is behind.
    return [];
  }
}
