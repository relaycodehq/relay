import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { trackRun } from "./last-run";

let dir = "";

afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("counts runs in a row that never quit, until one does", () => {
  dir = mkdtempSync(join(tmpdir(), "relay-run-"));
  const dumps = join(dir, "Crashpad");
  expect(trackRun(dir, "1.0.0", dumps, 1000).last).toBeNull();
  expect(trackRun(dir, "1.0.0", dumps, 2000).last).toEqual({
    version: "1.0.0",
    startedAt: 1000,
    crashes: 1,
    early: 1,
    dump: false,
  });
  const third = trackRun(dir, "1.0.1", dumps, 3000);
  expect(third.last?.crashes).toBe(2);
  third.quit();
  expect(trackRun(dir, "1.0.1", dumps, 4000).last).toBeNull();
});

it("stays quit when the startup mark comes after the quit", () => {
  dir = mkdtempSync(join(tmpdir(), "relay-run-"));
  const dumps = join(dir, "Crashpad");
  const run = trackRun(dir, "1.0.0", dumps, 1000);
  run.quit();
  run.started();
  expect(trackRun(dir, "1.0.0", dumps, 2000).last).toBeNull();
});

it("counts the crashes at startup in a row apart from later ones", () => {
  dir = mkdtempSync(join(tmpdir(), "relay-run-"));
  const dumps = join(dir, "Crashpad");
  trackRun(dir, "1.0.0", dumps, 1000).started();
  // Killed after its window came up, as an installer does: no crash loop.
  expect(trackRun(dir, "1.0.0", dumps, 2000).last).toMatchObject({
    crashes: 1,
    early: 0,
  });
  // Then two that died starting.
  expect(trackRun(dir, "1.0.0", dumps, 3000).last).toMatchObject({
    crashes: 2,
    early: 1,
  });
  const fourth = trackRun(dir, "1.0.0", dumps, 4000);
  expect(fourth.last).toMatchObject({ crashes: 3, early: 2 });
  // One that got through starts the count again.
  fourth.started();
  expect(trackRun(dir, "1.0.0", dumps, 5000).last).toMatchObject({
    crashes: 4,
    early: 0,
  });
});

it("tells a crash that left a dump from an older dump", () => {
  dir = mkdtempSync(join(tmpdir(), "relay-run-"));
  const dumps = join(dir, "Crashpad");
  mkdirSync(join(dumps, "completed"), { recursive: true });
  const dump = join(dumps, "completed", "a.dmp");
  writeFileSync(dump, "");
  utimesSync(dump, 1, 1);
  trackRun(dir, "1.0.0", dumps, 5000);
  expect(trackRun(dir, "1.0.0", dumps, 6000).last?.dump).toBe(false);
  utimesSync(dump, 7, 7);
  expect(trackRun(dir, "1.0.0", dumps, 8000).last?.dump).toBe(true);
});

it("leaves out a run the computer restarted under, unless it left a dump", () => {
  dir = mkdtempSync(join(tmpdir(), "relay-run-"));
  const dumps = join(dir, "Crashpad");
  trackRun(dir, "1.0.0", dumps, 1000, 0);
  expect(trackRun(dir, "1.0.0", dumps, 9000, 5000).last).toBeNull();
  mkdirSync(dumps, { recursive: true });
  writeFileSync(join(dumps, "a.dmp"), "");
  utimesSync(join(dumps, "a.dmp"), 10, 10);
  expect(trackRun(dir, "1.0.0", dumps, 20000, 15000).last?.dump).toBe(true);
});

it("doesn't count an older Relay's run, which never said it started, as a crash at startup", () => {
  dir = mkdtempSync(join(tmpdir(), "relay-run-"));
  const dumps = join(dir, "Crashpad");
  writeFileSync(
    join(dir, "running.json"),
    JSON.stringify({ version: "0.14.0", startedAt: 1000, crashes: 0 }),
  );
  expect(trackRun(dir, "0.15.0", dumps, 2000).last).toMatchObject({
    crashes: 1,
    early: 0,
  });
  // The first new run that dies starting is the first in a row, not the second.
  expect(trackRun(dir, "0.15.0", dumps, 3000).last).toMatchObject({
    crashes: 2,
    early: 1,
  });
});
