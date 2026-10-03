import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

const limit = 1 << 20;

/**
 * Copies the main process's warnings, errors and crashes to `main.log` in
 * `dir`. A packaged app's console goes nowhere on any platform, so without
 * this what Relay reports about itself is gone. Past 1 MB the file moves to
 * `main.old.log` and starts over.
 */
export function startLog(dir: string, version: string) {
  const file = join(dir, "main.log");
  let size = 0;
  try {
    mkdirSync(dir, { recursive: true });
    size = statSync(file).size;
  } catch {
    // No file yet; the first write makes it.
  }
  const write = (level: string, args: unknown[]) => {
    const line = `${new Date().toISOString()} ${level} ${format(...args)}\n`;
    try {
      if (size > 0 && size + line.length > limit) {
        renameSync(file, join(dir, "main.old.log"));
        size = 0;
      }
      appendFileSync(file, line);
      size += line.length;
    } catch {
      // A log that can't be written has nowhere to say so.
    }
  };
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      write(level, args);
    };
  }
  // The monitor only watches: Electron still shows its dialog for the crash.
  process.on("uncaughtExceptionMonitor", (error) => write("uncaught", [error]));
  process.on("unhandledRejection", (reason) =>
    console.error("Unhandled rejection:", reason),
  );
  write("info", [`Relay ${version} started`]);
  return file;
}
