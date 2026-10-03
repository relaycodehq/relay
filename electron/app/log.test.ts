import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { startLog } from "./log";

const { warn, error } = console;
const before = {
  monitor: process.listeners("uncaughtExceptionMonitor"),
  rejection: process.listeners("unhandledRejection"),
};
let dir = "";

afterEach(() => {
  Object.assign(console, { warn, error });
  for (const l of process.listeners("uncaughtExceptionMonitor"))
    if (!before.monitor.includes(l)) process.off("uncaughtExceptionMonitor", l);
  for (const l of process.listeners("unhandledRejection"))
    if (!before.rejection.includes(l)) process.off("unhandledRejection", l);
  rmSync(dir, { recursive: true, force: true });
});

it("keeps warnings with their stack and starts over past 1 MB", () => {
  dir = mkdtempSync(join(tmpdir(), "relay-log-"));
  Object.assign(console, { warn: () => {}, error: () => {} });
  const file = startLog(join(dir, "logs"), "1.2.3");
  console.warn("Could not clean up worktrees:", new Error("busy"));
  const text = readFileSync(file, "utf8");
  expect(text).toMatch(/info Relay 1\.2\.3 started/);
  expect(text).toMatch(
    /warn Could not clean up worktrees: Error: busy\n\s+at /,
  );

  const big = "x".repeat(300_000);
  for (let i = 0; i < 4; i++) console.error(big);
  expect(statSync(join(dir, "logs", "main.old.log")).size).toBeGreaterThan(0);
  expect(statSync(file).size).toBeLessThanOrEqual(1 << 20);
  expect(readFileSync(file, "utf8")).toMatch(/^\S+ error x+\n$/);
});
