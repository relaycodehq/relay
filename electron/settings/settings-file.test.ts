import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
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
  file.follow();
  // Watching from here on.
  await file.flush();
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

it("edits only the keys Settings changes, keeping comments, and reports each change once", async () => {
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
  expect(changes).toEqual([state]);

  // A later outside edit is still noticed, and the save's own watch event isn't.
  await script('{ "typography": { "interfaceSize": 12 } }', () =>
    expect(changes).toHaveLength(2),
  );
  expect(changes[1].values).toEqual({ typography: { interfaceSize: 12 } });
});

it("keeps the file's layout around what a save changes", async () => {
  const saved = async (
    text: string,
    edits: Parameters<SettingsFile["update"]>[0],
  ) => {
    await writeFile(join(dir, "settings.json"), text);
    file?.close();
    await open();
    await file.update(edits);
    return readFile(join(dir, "settings.json"), "utf8");
  };
  // A one-line file stays on one line.
  expect(
    await saved('{ "typography": { "codeSize": 15 } }\n', [
      { path: ["appearance", "mode"], value: "light" },
    ]),
  ).toBe(
    '{ "typography": { "codeSize": 15 }, "appearance": { "mode": "light" } }\n',
  );
  // A one-line section beside the new key keeps its line; the file's indent is used.
  expect(
    await saved('{\n    "appearance": { "mode": "light" }\n}\n', [
      { path: ["keepAwake"], value: false },
      { path: ["threads", "autoSettleDays"], value: 5 },
    ]),
  ).toBe(
    [
      "{",
      '    "appearance": { "mode": "light" },',
      '    "keepAwake": false,',
      '    "threads": {',
      '        "autoSettleDays": 5',
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  // Removing the first key leaves the next one on its own line.
  expect(
    await saved('{\n  "chat": { "width": 1200 },\n  "keepAwake": false\n}\n', [
      { path: ["chat", "width"], value: undefined },
      { path: ["appearance", "mode"], value: "dark" },
    ]),
  ).toBe(
    '{\n  "keepAwake": false,\n  "appearance": {\n    "mode": "dark"\n  }\n}\n',
  );
  expect(
    await saved('{\n  "chat": 1, "keepAwake": false\n}\n', [
      { path: ["chat"], value: undefined },
    ]),
  ).toBe('{\n  "keepAwake": false\n}\n');
  // A new file is spread out.
  await rm(join(dir, "settings.json"));
  file.close();
  await open();
  await file.update([{ path: ["chat", "sendKey"], value: "mod-enter" }]);
  expect(await readFile(join(dir, "settings.json"), "utf8")).toBe(
    '{\n  "chat": {\n    "sendKey": "mod-enter"\n  }\n}\n',
  );
});

it("removes a key that isn't there as nothing to do, and says which section isn't one", async () => {
  await writeFile(join(dir, "settings.json"), '{ "chat": 1 }');
  await open();
  await file.update([
    { path: ["threads", "autoSettleDays"], value: undefined },
  ]);
  await file.update([{ path: ["chat", "width"], value: undefined }]);
  expect(file.state().values).toEqual({ chat: 1 });
  await expect(
    file.update([{ path: ["chat", "width"], value: 1200 }]),
  ).rejects.toThrow(/"chat" in settings.json should be a \{ … \} section/);
});

it("saves through a symlink into the dotfiles and follows edits made there", async () => {
  const dotfiles = join(root, "dotfiles");
  await mkdir(dotfiles);
  const target = join(dotfiles, "settings.json");
  await writeFile(target, '{ "typography": { "interfaceSize": 14 } }');
  await symlink(target, join(dir, "settings.json"));
  await open();
  await file.update([{ path: ["typography", "codeSize"], value: 13 }]);
  expect((await lstat(join(dir, "settings.json"))).isSymbolicLink()).toBe(true);
  expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
    typography: { interfaceSize: 14, codeSize: 13 },
  });

  await vi.waitFor(async () => {
    await writeFile(target, '{ "typography": { "interfaceSize": 16 } }');
    expect(changes.at(-1)?.values).toEqual({
      typography: { interfaceSize: 16 },
    });
  });
});

it("finds a folder and file a script makes after Relay started", async () => {
  await rm(dir, { recursive: true });
  await open();
  // A folder made the moment a watch starts can go unseen on macOS; the
  // script's next try is seen.
  await vi.waitFor(async () => {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir);
    await replace('{ "chat": { "sendKey": "mod-enter" } }');
    await vi.waitFor(
      () =>
        expect(changes.at(-1)?.values).toEqual({
          chat: { sendKey: "mod-enter" },
        }),
      { timeout: 500 },
    );
  });
});

it("tells of an outside edit a save took in before its watch event came", async () => {
  await writeFile(join(dir, "settings.json"), "{}");
  await open();
  // Written straight away, so the save reads it before the watch settles.
  await writeFile(
    join(dir, "settings.json"),
    '{ "typography": { "interfaceSize": 15 } }',
  );
  await file.update([{ path: ["keepAwake"], value: false }]);
  expect(changes.at(-1)?.values).toEqual({
    typography: { interfaceSize: 15 },
    keepAwake: false,
  });
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

it("reads a file saved with a BOM, as PowerShell and older Notepads write it", async () => {
  await writeFile(
    join(dir, "settings.json"),
    '\uFEFF{ "typography": { "interfaceSize": 15 } }',
  );
  await open();
  expect(file.state()).toEqual({
    path: join(dir, "settings.json"),
    values: { typography: { interfaceSize: 15 } },
  });
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
