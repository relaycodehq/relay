import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { startLog } from "./log";
import { logTo } from "../headless/log";

const { log, info, warn, error } = console;
const before = {
  monitor: process.listeners("uncaughtExceptionMonitor"),
  rejection: process.listeners("unhandledRejection"),
};
let dir = "";

afterEach(() => {
  Object.assign(console, { log, info, warn, error });
  for (const l of process.listeners("uncaughtExceptionMonitor"))
    if (!before.monitor.includes(l)) process.off("uncaughtExceptionMonitor", l);
  for (const l of process.listeners("unhandledRejection"))
    if (!before.rejection.includes(l)) process.off("unhandledRejection", l);
  rmSync(dir, { recursive: true, force: true });
});

it.each([
  { name: "desktop", limit: 1 << 20, old: "main.old.log" },
  { name: "headless", limit: 5 << 20, old: "relay.old.log" },
])("rotates $name logs by UTF-8 bytes", ({ name, limit, old }) => {
  dir = mkdtempSync(join(tmpdir(), "relay-log-"));
  Object.assign(console, { warn: () => {} });
  const file = join(dir, name === "desktop" ? "main.log" : "relay.log");
  if (name === "desktop") startLog(dir);
  else logTo(file, { echo: false });
  const text = "界".repeat(Math.ceil(limit / 6) + 10);
  console.warn(text);
  console.warn(text);
  expect(statSync(join(dir, old)).size).toBeGreaterThan(limit / 2);
  expect(statSync(file).size).toBeLessThanOrEqual(limit);
  expect(readFileSync(file, "utf8")).toMatch(/^\S+ warn 界+\n$/u);
});

it.each([false, true])(
  "keeps headless logging private with echo %s",
  (echo) => {
    dir = mkdtempSync(join(tmpdir(), "relay-log-"));
    const output = vi.fn();
    Object.assign(console, {
      log: output,
      info: output,
      warn: output,
      error: output,
    });
    const file = join(dir, "logs", "relay.log");
    logTo(file, { echo });
    console.log("ready %d", 3);
    console.info("listening");
    console.warn("warning");
    console.error(new Error("broken"));
    expect(output).toHaveBeenCalledTimes(echo ? 4 : 0);
    const contents = readFileSync(file, "utf8");
    expect(contents).toMatch(/info ready 3\n/);
    expect(contents).toMatch(/info listening\n/);
    expect(contents).toMatch(/warn warning\n/);
    expect(contents).toMatch(/error Error: broken\n\s+at /);
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "logs")).mode & 0o777).toBe(0o700);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  },
);

it("keeps warnings with their stack and starts over past 1 MB", () => {
  dir = mkdtempSync(join(tmpdir(), "relay-log-"));
  Object.assign(console, { warn: () => {}, error: () => {} });
  const file = startLog(join(dir, "logs"));
  console.warn("Could not clean up worktrees:", new Error("busy"));
  const text = readFileSync(file, "utf8");
  expect(text).toMatch(
    /warn Could not clean up worktrees: Error: busy\n\s+at /,
  );

  const big = "x".repeat(300_000);
  for (let i = 0; i < 4; i++) console.error(big);
  expect(statSync(join(dir, "logs", "main.old.log")).size).toBeGreaterThan(0);
  expect(statSync(file).size).toBeLessThanOrEqual(1 << 20);
  expect(readFileSync(file, "utf8")).toMatch(/^\S+ error x+\n$/);
});
