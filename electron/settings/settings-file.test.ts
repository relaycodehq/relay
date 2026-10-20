import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SettingsFileState } from "../../shared/settings-file";
import { SettingsFile, settingsDir } from "./settings-file";

let root: string;
let dir: string;
let file: SettingsFile;
let changes: SettingsFileState[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-settings-"));
  dir = join(root, "relay");
  await mkdir(dir);
  changes = [];
});
afterEach(async () => {
  file?.close();
  await rm(root, { recursive: true, force: true });
});

async function open() {
  file = new SettingsFile(dir, (state) => changes.push(state));
  await file.load();
  return file;
}

/**
 * What a script does, until Relay notices: macOS restarts its one event
 * stream as a watch is added, and a change in that moment goes unseen.
 */
async function script(text: string, noticed: () => void) {
  await vi.waitFor(async () => {
    await replace(text);
    noticed();
  });
}

/** Writes beside the file, then renames over it. */
async function replace(text: string) {
  const path = join(dir, "settings.json");
  const tmp = `${path}.${Math.random()}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

it("follows a file a script replaces while Relay runs, and keeps the last good values while it's broken", async () => {
  await writeFile(
    join(dir, "settings.json"),
    '{ "typography": { "interfaceSize": 14 } }',
  );
  await open();
  expect(file.state().values).toEqual({ typography: { interfaceSize: 14 } });

  await script('{ "typography": { "interfaceSize": 16 } }', () =>
    expect(changes).toHaveLength(1),
  );
  expect(changes[0].values).toEqual({ typography: { interfaceSize: 16 } });

  await script('{ "typography": { "interfaceSize": 15, } \n "chat": 1 }', () =>
    expect(changes).toHaveLength(2),
  );
  expect(changes[1].values).toEqual({ typography: { interfaceSize: 16 } });
  expect(changes[1].error).toMatchObject({ line: 2 });

  await script('{ "typography": { "interfaceSize": 15 } }', () =>
    expect(changes).toHaveLength(3),
  );
  expect(changes[2]).toEqual({
    path: join(dir, "settings.json"),
    values: { typography: { interfaceSize: 15 } },
  });
});

it("edits only the keys Settings changes, keeping comments, and doesn't report its own writes", async () => {
  await writeFile(
    join(dir, "settings.json"),
    [
      "{",
      "    // Home monitor",
      '    "typography": { "interfaceSize": 14 },',
      '    "chat": { "width": 1200 },',
      '    "sounds": { "done": "chime" }',
      "}",
      "",
    ].join("\n"),
  );
  await open();
  const state = await file.update([
    { path: ["typography", "codeSize"], value: 13 },
    { path: ["chat", "width"], value: undefined },
  ]);
  expect(state.values).toEqual({
    typography: { interfaceSize: 14, codeSize: 13 },
    sounds: { done: "chime" },
  });
  const text = await readFile(join(dir, "settings.json"), "utf8");
  expect(text).toContain("    // Home monitor");
  expect(text).not.toContain("chat");

  // A later outside edit is still noticed, and only that one.
  await script('{ "typography": { "interfaceSize": 12 } }', () =>
    expect(changes).toHaveLength(1),
  );
  expect(changes[0].values).toEqual({ typography: { interfaceSize: 12 } });
});

it("creates the folder and file on the first save", async () => {
  await rm(dir, { recursive: true });
  await open();
  expect(file.state().values).toEqual({});
  await file.update([{ path: ["chat", "sendKey"], value: "mod-enter" }]);
  expect(
    JSON.parse(await readFile(join(dir, "settings.json"), "utf8")),
  ).toEqual({ chat: { sendKey: "mod-enter" } });

  // Watching starts with the folder.
  await script('{ "chat": { "sendKey": "enter" } }', () =>
    expect(changes).toHaveLength(1),
  );
});

it("leaves a file that doesn't parse for its owner to fix", async () => {
  const broken = '{ "typography": { "interfaceSize": 14 ';
  await writeFile(join(dir, "settings.json"), broken);
  await open();
  expect(file.state().error).toBeDefined();
  await expect(
    file.update([{ path: ["typography", "codeSize"], value: 13 }]),
  ).rejects.toThrow(/line 1/);
  expect(await readFile(join(dir, "settings.json"), "utf8")).toBe(broken);
});

it("puts the file in XDG's config folder, with the dotfiles on macOS, and in app data on Windows", () => {
  const where = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) =>
    settingsDir({ platform, env, home: "/home/me", appData: "C:\\AppData" });
  expect(where("linux")).toBe("/home/me/.config/relay");
  expect(where("linux", { XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/relay");
  expect(where("linux", { XDG_CONFIG_HOME: "relative" })).toBe(
    "/home/me/.config/relay",
  );
  expect(where("darwin")).toBe("/home/me/.config/relay");
  expect(where("win32")).toBe(join("C:\\AppData", "Relay"));
});
