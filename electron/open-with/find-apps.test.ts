import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findLinuxApps, findMacApps, findWindowsApps } from "./find-apps";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-open-with-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function touch(...paths: string[]) {
  for (const path of paths) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), "");
  }
}

const bundle = (path: string) => mkdir(join(root, path), { recursive: true });

describe("findMacApps", () => {
  it("offers the known bundles in the table's order, each from the first folder that has it", async () => {
    await bundle("Applications/Xcode.app");
    await bundle("Applications/PhpStorm.app");
    await bundle("Applications/Figma.app");
    await bundle("home/Applications/Cursor.app");
    await bundle("home/Applications/PhpStorm.app");
    await bundle("home/Applications/JetBrains Toolbox/WebStorm.app");
    await bundle("home/Applications/Zed Preview.app");

    const apps = await findMacApps([
      join(root, "Applications"),
      join(root, "home/Applications"),
      join(root, "home/Applications/JetBrains Toolbox"),
      join(root, "missing"),
    ]);

    expect(apps).toEqual([
      {
        id: "cursor",
        name: "Cursor",
        path: join(root, "home/Applications/Cursor.app"),
      },
      {
        id: "zed",
        name: "Zed",
        path: join(root, "home/Applications/Zed Preview.app"),
      },
      {
        id: "phpstorm",
        name: "PhpStorm",
        path: join(root, "Applications/PhpStorm.app"),
      },
      {
        id: "webstorm",
        name: "WebStorm",
        path: join(root, "home/Applications/JetBrains Toolbox/WebStorm.app"),
      },
      {
        id: "xcode",
        name: "Xcode",
        path: join(root, "Applications/Xcode.app"),
      },
    ]);
  });
});

describe("findWindowsApps", () => {
  it("finds editors in their install folders and each JetBrains IDE's newest install", async () => {
    await touch(
      "local/Programs/Microsoft VS Code/Code.exe",
      "local/Programs/cursor/Cursor.txt",
      "files/JetBrains/PhpStorm 2024.3/bin/phpstorm64.exe",
      "files/JetBrains/PhpStorm 2025.2/bin/phpstorm64.exe",
      "files/JetBrains/IntelliJ IDEA Community Edition 2025.2/bin/idea64.exe",
      "local/Programs/RustRover/bin/rustrover64.exe",
      "local/JetBrains/Toolbox/apps/Rider/ch-0/243.1.2/bin/rider64.exe",
      "local/JetBrains/Toolbox/apps/Rider/ch-0/251.3.4/bin/rider64.exe",
      "local/JetBrains/Toolbox/apps/Rider/ch-0/251.3.4.plugins/x.jar",
    );

    const apps = await findWindowsApps({
      LOCALAPPDATA: join(root, "local"),
      ProgramFiles: join(root, "files"),
    });

    expect(apps.map(({ id, path }) => [id, path])).toEqual([
      ["vscode", join(root, "local/Programs/Microsoft VS Code/Code.exe")],
      [
        "phpstorm",
        join(root, "files/JetBrains/PhpStorm 2025.2/bin/phpstorm64.exe"),
      ],
      // The Community Edition's folder isn't IntelliJ IDEA's.
      [
        "idea-ce",
        join(
          root,
          "files/JetBrains/IntelliJ IDEA Community Edition 2025.2/bin/idea64.exe",
        ),
      ],
      ["rustrover", join(root, "local/Programs/RustRover/bin/rustrover64.exe")],
      [
        "rider",
        join(
          root,
          "local/JetBrains/Toolbox/apps/Rider/ch-0/251.3.4/bin/rider64.exe",
        ),
      ],
    ]);
  });

  it("looks nowhere the environment doesn't name", async () => {
    await touch("local/Programs/Microsoft VS Code/Code.exe");
    expect(await findWindowsApps({})).toEqual([]);
  });
});

describe("findLinuxApps", () => {
  it("finds the commands that can run, in the folders' order", async () => {
    const runnable = [
      "bin/code",
      "bin/zeditor",
      "bin/notepad",
      "toolbox/phpstorm",
      "toolbox/code",
    ];
    await touch(...runnable, "bin/phpstorm");
    for (const path of runnable) await chmod(join(root, path), 0o755);
    // bin/phpstorm can't run, so Toolbox's script further along is the one.

    const apps = await findLinuxApps([
      join(root, "bin"),
      "",
      join(root, "toolbox"),
    ]);

    expect(apps.map(({ id, path }) => [id, path])).toEqual([
      ["vscode", join(root, "bin/code")],
      ["zed", join(root, "bin/zeditor")],
      ["phpstorm", join(root, "toolbox/phpstorm")],
    ]);
  });
});
