import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let scratch, home;
beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), "relay-dev-home-test-"));
  for (const key of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "XDG_CONFIG_HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
  ])
    vi.stubEnv(key, scratch);
  vi.resetModules();
  home = await import("./dev-home.mjs");
  expect(home.userData.startsWith(scratch)).toBe(true);
  mkdirSync(home.userData, { recursive: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

it("removes newer saved data, keeps caches, and backs up everything replaced", () => {
  const file = (name) => join(home.userData, name);
  writeFileSync(file("state.json"), "old state");
  const snapshot = home.snapshot("baseline");
  writeFileSync(file("state.json"), "new state");
  writeFileSync(file("usage.jsonl"), "new usage");
  for (const name of ["IndexedDB", "Local Storage", "project-chats", "Cache"]) {
    mkdirSync(file(name));
    writeFileSync(join(file(name), "new"), "newer");
  }
  home.restore(basename(snapshot));
  expect(readFileSync(file("state.json"), "utf8")).toBe("old state");
  expect(readdirSync(home.userData).sort()).toEqual([
    "Cache",
    "Dev snapshots",
    "state.json",
  ]);
  const backup = join(
    file("Dev snapshots"),
    home.listSnapshots().find((name) => name.endsWith("before restore")),
  );
  expect(readFileSync(join(backup, "state.json"), "utf8")).toBe("new state");
  expect(readFileSync(join(backup, "usage.jsonl"), "utf8")).toBe("new usage");
  expect(readFileSync(join(backup, "IndexedDB", "new"), "utf8")).toBe("newer");
});

it("does not touch live data when the snapshot is missing", () => {
  writeFileSync(join(home.userData, "state.json"), "preserve me");
  expect(() => home.restore("missing")).toThrow();
  expect(readFileSync(join(home.userData, "state.json"), "utf8")).toBe(
    "preserve me",
  );
});

it("keeps eight snapshots and uses Windows-safe folder labels", () => {
  for (let i = 0; i < 10; i++) home.snapshot(`branch<>|${i}`);
  expect(home.listSnapshots()).toHaveLength(8);
  expect(home.listSnapshots().every((name) => !/[<>|]/.test(name))).toBe(true);
});
