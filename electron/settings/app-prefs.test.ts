import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Store } from "../app/store";
import { movePrefsToFile, readPrefs, savePref } from "./app-prefs";
import { SettingsFile } from "./settings-file";

let dir: string;
let file: SettingsFile;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-prefs-"));
});
afterEach(async () => {
  file?.close();
  await rm(dir, { recursive: true, force: true });
});

it("moves preferences out of state.json into settings.json, keeping what the file already says", async () => {
  await writeFile(
    join(dir, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      keepAwake: false,
      autoSettleDays: null,
      watchThreads: "main",
      worktreeCleanupDays: 3,
    }),
  );
  await writeFile(
    join(dir, "settings.json"),
    '{ "threads": { "watch": "subagents" } }',
  );
  const store = new Store(dir);
  await store.load();
  file = new SettingsFile(dir, () => {});
  await file.load();

  await movePrefsToFile(store, file);
  expect(readPrefs(file.state().values)).toEqual({
    keepAwake: false,
    usagePing: true,
    autoSettleDays: null,
    worktreeCleanupDays: 3,
    watchThreads: "subagents",
  });
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  expect(state).not.toHaveProperty("keepAwake");
  expect(state).not.toHaveProperty("watchThreads");
});

it("reads defaults for keys that are missing or don't read, and saves a default by leaving the file", async () => {
  await writeFile(
    join(dir, "settings.json"),
    '{ "keepAwake": "yes", "threads": { "autoSettleDays": 400 } }',
  );
  file = new SettingsFile(dir, () => {});
  await file.load();
  expect(readPrefs(file.state().values)).toEqual({
    keepAwake: true,
    usagePing: true,
    autoSettleDays: 3,
    worktreeCleanupDays: null,
    watchThreads: "off",
  });

  await savePref(file, "autoSettleDays", 7);
  await savePref(file, "keepAwake", true);
  expect(file.state().values).toEqual({ threads: { autoSettleDays: 7 } });
  await savePref(file, "autoSettleDays", 3);
  // A default for a section the file doesn't have is nothing to do.
  await savePref(file, "watchThreads", "off");
  expect(file.state().values).toEqual({});
});
