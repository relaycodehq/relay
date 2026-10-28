import type { WebContents } from "electron";
import type { ConsoleEntry } from "../../shared/preview";

const KEPT_CONSOLE = 200;

/** Keeps the page's latest errors and warnings, for `console_errors`. */
export function keepConsole(
  wc: WebContents,
  into: { console: ConsoleEntry[] },
) {
  wc.on("console-message", ({ level, message, sourceId, lineNumber }) => {
    if (level !== "error" && level !== "warning") return;
    // Electron's own warnings (an unpackaged build's CSP nag) aren't the page's.
    if (sourceId.startsWith("node:electron/")) return;
    into.console.push({
      level,
      message,
      source: sourceId ? `${sourceId}:${lineNumber}` : undefined,
      at: Date.now(),
    });
    if (into.console.length > KEPT_CONSOLE) into.console.shift();
  });
}
