import { join } from "node:path";
import { fileLog } from "../util/file-log";

/**
 * Copies the main process's notices (`console.info`), warnings, errors and
 * crashes to `main.log` in `dir`. A packaged app's console goes nowhere on
 * any platform, so without this what Relay reports about itself is gone.
 * Past 1 MB the file moves to `main.old.log` and starts over.
 */
export function startLog(dir: string) {
  return fileLog(join(dir, "main.log"), {
    previous: join(dir, "main.old.log"),
    limit: 1 << 20,
    echo: true,
  });
}
