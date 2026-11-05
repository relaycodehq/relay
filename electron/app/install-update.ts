import { app } from "electron";
import { spawn, execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { UpdateTarget } from "../../shared/updates";

const run = promisify(execFile);

export interface Install {
  target: UpdateTarget;
  /** Set when this copy can't replace itself; the button opens the download page instead. */
  manual?: string;
}

/** Works out which download fits the running copy and whether it can swap itself in. */
export async function detectInstall(): Promise<Install | null> {
  const arch = process.arch;
  if (process.platform === "darwin") {
    if (arch !== "arm64") return null;
    const target = "mac-arm64";
    const bundle = resolve(process.execPath, "../../..");
    if (!app.isPackaged || !bundle.endsWith(".app"))
      return { target, manual: "Development build" };
    if (bundle.includes("/AppTranslocation/"))
      return {
        target,
        manual: "Move Relay to Applications to enable automatic updates.",
      };
    try {
      await access(dirname(bundle), constants.W_OK);
    } catch {
      return { target, manual: "Relay's folder isn't writable." };
    }
    return { target };
  }
  if (process.platform === "win32") {
    if (arch !== "x64") return null;
    return app.isPackaged
      ? { target: "win-x64" }
      : { target: "win-x64", manual: "Development build" };
  }
  if (process.platform === "linux" && arch === "x64") {
    if (process.env.APPIMAGE) return { target: "linux-x64-appimage" };
    if (existsSync(join(dirname(process.execPath), ".installer")))
      return { target: "linux-x64-omarchy" };
    return {
      target: "linux-x64-omarchy",
      manual: app.isPackaged
        ? "Installed without the Relay installer."
        : "Development build",
    };
  }
  return null;
}

/** Unpacks what needs unpacking while the app is still running normally. */
export async function prepare(target: UpdateTarget, path: string, dir: string) {
  if (target === "mac-arm64") {
    const out = join(dir, "unpacked");
    await run("/usr/bin/ditto", ["-x", "-k", path, out]);
    const bundle = (await readdir(out)).find((n) => n.endsWith(".app"));
    if (!bundle) throw new Error("The download doesn't contain Relay.app.");
    // Downloads made by the app aren't quarantined, but be sure Gatekeeper won't block the relaunch.
    await run("/usr/bin/xattr", [
      "-dr",
      "com.apple.quarantine",
      join(out, bundle),
    ]).catch(() => {});
    await rm(path, { force: true });
    return join(out, bundle);
  }
  if (target === "linux-x64-omarchy") {
    const out = join(dir, "unpacked");
    await mkdir(out);
    await run("tar", ["-xzf", path, "-C", out]);
    const bundle = (await readdir(out)).find((n) =>
      existsSync(join(out, n, "install.py")),
    );
    if (!bundle) throw new Error("The download doesn't contain the installer.");
    return join(out, bundle);
  }
  return path;
}

export async function apply(target: UpdateTarget, staged: string) {
  switch (target) {
    case "mac-arm64": {
      // Swap the bundle once this process has exited, then open the new copy.
      const bundle = resolve(process.execPath, "../../..");
      const script = join(dirname(dirname(staged)), "swap.sh");
      await writeFile(
        script,
        [
          "#!/bin/sh",
          'pid="$1"; old="$2"; new="$3"',
          'while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done',
          'rm -rf "$old.previous"',
          'if mv "$old" "$old.previous"; then',
          '  if mv "$new" "$old"; then rm -rf "$old.previous"; else mv "$old.previous" "$old"; fi',
          "fi",
          'open "$old"',
          'rm -rf "$(dirname "$0")"',
          "",
        ].join("\n"),
        { mode: 0o700 },
      );
      spawn("/bin/sh", [script, String(process.pid), bundle, staged], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return;
    }
    case "win-x64":
      // electron-builder's NSIS installer kills a Relay still running a few
      // seconds after it starts, then relaunches it. Started any earlier, it
      // would cut short the save on quit, or a quit the user cancelled.
      app.once("will-quit", () => {
        const installer = spawn(staged, ["--updated", "/S", "--force-run"], {
          detached: true,
          stdio: "ignore",
        });
        // Unhandled, a missing installer would stop the quit with an error box.
        installer.on("error", (error) =>
          console.warn("Could not start the update installer:", error),
        );
        installer.unref();
      });
      return;
    case "linux-x64-appimage": {
      const current = process.env.APPIMAGE!;
      const next = `${current}.update`;
      await copyFile(staged, next);
      await chmod(next, 0o755);
      await rename(next, current);
      app.relaunch({ execPath: current, args: process.argv.slice(1) });
      return;
    }
    case "linux-x64-omarchy": {
      // The bundled installer replaces ~/.local/lib/relay-experimental in place.
      const prefix = resolve(dirname(process.execPath), "../..");
      const args = [join(staged, "install.py")];
      if (prefix !== join(homedir(), ".local")) args.push("--prefix", prefix);
      try {
        await run("python3", args);
      } catch (error) {
        const detail = (error as { stderr?: string }).stderr?.trim();
        throw new Error(detail || "The Relay installer failed.");
      }
      app.relaunch({ execPath: process.execPath, args: process.argv.slice(1) });
      return;
    }
  }
}
