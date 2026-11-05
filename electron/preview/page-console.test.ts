import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { expect, it } from "vitest";
import type { ConsoleEntry } from "../../shared/preview";
import { keepConsole } from "./page-console";

it("keeps only the start of a huge message, so a noisy page can't fill memory", () => {
  const page = new EventEmitter();
  const into = { console: [] as ConsoleEntry[] };
  keepConsole(page as unknown as WebContents, into);
  page.emit("console-message", {
    level: "error",
    message: "x".repeat(5_000_000),
    sourceId: "http://localhost:5173/app.js",
    lineNumber: 3,
  });
  expect(into.console[0].message.length).toBeLessThanOrEqual(10_000);
  expect(into.console[0].message.startsWith("xxx")).toBe(true);
});
