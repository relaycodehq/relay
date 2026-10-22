import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { format } from "node:util";

/** Capture process notices with bounded rotation, measuring the bytes written to disk. */
export function fileLog(
  file: string,
  {
    previous,
    limit,
    echo,
    privateFiles = false,
    levels = ["info", "warn", "error"],
  }: {
    previous: string;
    limit: number;
    echo: boolean;
    privateFiles?: boolean;
    levels?: ("log" | "info" | "warn" | "error")[];
  },
) {
  let size = 0;
  try {
    mkdirSync(dirname(file), {
      recursive: true,
      ...(privateFiles ? { mode: 0o700 } : {}),
    });
    size = statSync(file).size;
  } catch {
    // No file yet; the first write makes it.
  }
  const write = (level: string, args: unknown[]) => {
    const line = `${new Date().toISOString()} ${level} ${format(...args)}\n`;
    const bytes = Buffer.byteLength(line);
    try {
      if (size > 0 && size + bytes > limit) {
        renameSync(file, previous);
        size = 0;
      }
      appendFileSync(file, line, privateFiles ? { mode: 0o600 } : {});
      size += bytes;
    } catch {
      // A log that can't be written has nowhere to say so.
    }
  };
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (echo) original(...args);
      write(level === "log" ? "info" : level, args);
    };
  }
  // Monitoring leaves the runtime's crash handling in charge.
  process.on("uncaughtExceptionMonitor", (error) => write("uncaught", [error]));
  process.on("unhandledRejection", (reason) =>
    console.error("Unhandled rejection:", reason),
  );
  return file;
}
