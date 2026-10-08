import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { format } from "node:util";

const limit = 5 << 20;

/**
 * Sends everything Relay says about itself to `file`, timestamped; past
 * 5 MB the file moves to `relay.old.log` and starts over. `echo` also keeps
 * it on the terminal, for `relay run` in the foreground.
 */
export function logTo(file: string, { echo }: { echo: boolean }) {
  let size = 0;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    size = statSync(file).size;
  } catch {
    // No file yet; the first write makes it.
  }
  const write = (level: string, args: unknown[]) => {
    const line = `${new Date().toISOString()} ${level} ${format(...args)}\n`;
    try {
      if (size > 0 && size + line.length > limit) {
        renameSync(file, join(dirname(file), "relay.old.log"));
        size = 0;
      }
      appendFileSync(file, line, { mode: 0o600 });
      size += Buffer.byteLength(line);
    } catch {
      // A log that can't be written has nowhere to say so.
    }
  };
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (echo) original(...args);
      write(level === "log" ? "info" : level, args);
    };
  }
  process.on("uncaughtExceptionMonitor", (error) => write("uncaught", [error]));
  process.on("unhandledRejection", (reason) =>
    console.error("Unhandled rejection:", reason),
  );
}
