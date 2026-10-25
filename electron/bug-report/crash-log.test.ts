import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { startLog } from "../app/log";
import { crashedRunLog, keepCrashedRunLog } from "./crash-log";

const { info, warn, error } = console;

const before = {
  monitor: process.listeners("uncaughtExceptionMonitor"),
  rejection: process.listeners("unhandledRejection"),
};

let dir = "";

afterEach(() => {
  Object.assign(console, { info, warn, error });
  for (const l of process.listeners("uncaughtExceptionMonitor"))
    if (!before.monitor.includes(l)) process.off("uncaughtExceptionMonitor", l);
  for (const l of process.listeners("unhandledRejection"))
    if (!before.rejection.includes(l)) process.off("unhandledRejection", l);
  rmSync(dir, { recursive: true, force: true });
});

it("keeps the crashed run's log through this run's rotations", () => {
  dir = mkdtempSync(join(tmpdir(), "relay-crash-log-"));
  const logs = join(dir, "logs");
  Object.assign(console, { info: () => {}, warn: () => {}, error: () => {} });

  // The run that crashed.
  startLog(logs);
  console.info("Relay 1.0.0 started");
  console.error("Thread 7 blew up:", new Error("boom"));

  // The next launch: a new log writer appends to the same files.
  Object.assign(console, { info: () => {}, warn: () => {}, error: () => {} });
  startLog(logs);
  console.info("Relay 1.0.0 started");
  const kept = keepCrashedRunLog(logs, 1000);
  expect(kept).toBeTruthy();

  // This run logs enough to rotate main.log out twice over.
  const big = "x".repeat(300_000);
  for (let i = 0; i < 12; i++) console.warn(big);

  const text = crashedRunLog(logs, 1000)!;
  expect(text).toMatch(/error Thread 7 blew up: Error: boom/);
  // Only the crashed run and before: this run's first line is left out.
  expect(text.match(/info Relay 1\.0\.0 started/g)).toHaveLength(1);
  expect(text).not.toContain("xxxx");
});

it("keeps the three newest crashed runs, each bounded", () => {
  dir = mkdtempSync(join(tmpdir(), "relay-crash-log-"));
  const line = (i: number) =>
    `2026-10-13T10:00:00.000Z error line ${i} ${"y".repeat(100)}\n`;
  writeFileSync(
    join(dir, "main.log"),
    Array.from({ length: 30_000 }, (_, i) => line(i)).join(""),
  );
  for (const at of [1, 2, 3, 4]) keepCrashedRunLog(dir, at);
  expect(
    readdirSync(dir)
      .filter((f) => f.startsWith("crashed-run"))
      .sort(),
  ).toEqual(["crashed-run-2.log", "crashed-run-3.log", "crashed-run-4.log"]);
  const text = crashedRunLog(dir, 4)!;
  expect(text.length).toBeLessThanOrEqual(2 << 20);
  // Cut at a line, keeping the newest.
  expect(text).toMatch(/^2026-10-13T/);
  expect(text).toContain("line 29999");
});
