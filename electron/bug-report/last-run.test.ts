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
    dump: false,
  });
  const third = trackRun(dir, "1.0.1", dumps, 3000);
  expect(third.last?.crashes).toBe(2);
  third.quit();
  expect(trackRun(dir, "1.0.1", dumps, 4000).last).toBeNull();
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
