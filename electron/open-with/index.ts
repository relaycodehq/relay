// The editors and IDEs on this computer that the Files pane offers to open a
// file in, and opening it in one.
import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { OpenWithApp } from "../../shared/open-with";
import { errorMessage } from "../../shared/error-message";
import { pathReady } from "../platform/shell-path";
import {
  findLinuxApps,
  findMacApps,
  findWindowsApps,
  type FoundApp,
} from "./find-apps";

/** How long a search's answer holds: an editor installed since shows up after this. */
const searchHolds = 60_000;
let searched: { at: number; apps: Promise<FoundApp[]> } | undefined;
/** Icons by bundle or program, kept while Relay runs. */
const icons = new Map<string, Promise<string>>();

export async function openWithApps(): Promise<OpenWithApp[]> {
  const apps = await foundApps();
  return Promise.all(
    apps.map(async ({ id, name, path }) => ({
      id,
      name,
      icon: await iconOf(path),
    })),
  );
}

/** Opens `file` in the found app with that id; the renderer names the app, never its path. */
export async function openWith(appId: string, file: string) {
  const found = (await foundApps()).find((app) => app.id === appId);
  if (!found)
    throw new Error("That app isn't on this computer any more. Pick another.");
  await launch(found, file).catch((e) => {
    throw new Error(`${found.name} didn't open the file: ${errorMessage(e)}`);
  });
}

function foundApps() {
  if (!searched || Date.now() - searched.at > searchHolds) {
    const apps = searchApps();
    searched = { at: Date.now(), apps };
    apps.catch(() => {
      if (searched?.apps === apps) searched = undefined;
    });
  }
  return searched.apps;
}

async function searchApps() {
  const home = homedir();
  if (process.platform === "darwin")
    return findMacApps([
      "/Applications",
      join(home, "Applications"),
      // Toolbox 1 puts its launchers here; Toolbox 2 installs in ~/Applications.
      join(home, "Applications", "JetBrains Toolbox"),
    ]);
  if (process.platform === "win32") return findWindowsApps(process.env);
  await pathReady();
  return findLinuxApps([
    ...(process.env.PATH ?? "").split(delimiter),
    join(home, ".local", "bin"),
    join(home, ".local", "share", "JetBrains", "Toolbox", "scripts"),
    "/usr/local/bin",
    "/snap/bin",
  ]);
}

function iconOf(path: string) {
  let icon = icons.get(path);
  if (!icon) {
    icon = readIcon(path);
    icons.set(path, icon);
  }
  return icon;
}

async function readIcon(path: string) {
  // Linux gives a command the theme's icon for any program, no better than
  // the page's own generic one.
  if (process.platform === "linux") return "";
  if (process.platform === "darwin") {
    const own = await bundleIcon(path).catch(() => "");
    if (own) return own;
  }
  try {
    // Only "normal": Electron 44 on macOS 27 crashes the main process asking
    // for a "large" file icon.
    const image = await app.getFileIcon(path, { size: "normal" });
    return image.isEmpty() ? "" : image.toDataURL();
  } catch (e) {
    console.warn(`[open-with] no icon for ${path}: ${errorMessage(e)}`);
    return "";
  }
}

/**
 * A macOS app's own icon, from the .icns its Info.plist names, as a small
 * PNG: Electron's file icon for a bundle is the generic app icon here.
 */
async function bundleIcon(bundle: string) {
  const run = promisify(execFile);
  const plist = join(bundle, "Contents", "Info.plist");
  const { stdout } = await run("plutil", ["-extract", "CFBundleIconFile", "raw", "-o", "-", plist], { timeout: 5_000 });
  const name = stdout.trim().replace(/\.icns$/, "");
  if (!name) return "";
  const icns = join(bundle, "Contents", "Resources", `${name}.icns`);
  const png = join(tmpdir(), `relay-app-icon-${randomUUID()}.png`);
  try {
    await run("sips", ["-s", "format", "png", "-Z", "64", icns, "--out", png], { timeout: 10_000 });
    return `data:image/png;base64,${(await readFile(png)).toString("base64")}`;
  } finally {
    await rm(png, { force: true });
  }
}

async function launch({ path }: FoundApp, file: string) {
  if (process.platform === "darwin") {
    // open's own words say why, not Node's "Command failed: open -a …".
    await promisify(execFile)("open", ["-a", path, file], {
      timeout: 15_000,
    }).catch((e: Error & { stderr?: string }) => {
      throw new Error(e.stderr?.trim() || e.message);
    });
    return;
  }
  // Detached, so the app outlives Relay and its windows aren't Relay's.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(path, [file], { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
