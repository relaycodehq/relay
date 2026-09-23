import { app, net } from "electron";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
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
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  manifestSchema,
  newerVersion,
  updateFeed,
  type UpdateFile,
  type UpdateManifest,
  type UpdateState,
  type UpdateTarget,
} from "../shared/updates";

const run = promisify(execFile);
const checkEvery = 4 * 60 * 60 * 1000;

interface Install {
  target: UpdateTarget;
  /** Set when this copy can't replace itself; the button opens the download page instead. */
  manual?: string;
}

/** Works out which download fits the running copy and whether it can swap itself in. */
async function detectInstall(): Promise<Install | null> {
  const arch = process.arch;
  if (process.platform === "darwin") {
    const target = arch === "arm64" ? "mac-arm64" : "mac-x64";
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

export class Updater {
  private state: UpdateState;
  private install: Install | null = null;
  private manifest?: UpdateManifest;
  private staged?: { version: string; path: string };
  private busy = false;
  private timer?: NodeJS.Timeout;
  private readonly feed: string;

  constructor(private readonly emit: (state: UpdateState) => void) {
    const current = app.getVersion();
    // Development builds stay quiet unless a feed is set to exercise the UI.
    const override = process.env.RELAY_UPDATE_FEED;
    this.feed = override || updateFeed;
    this.state =
      app.isPackaged || override
        ? { status: "idle", current }
        : { status: "off", current };
  }

  get current() {
    return this.state;
  }

  start() {
    if (this.state.status === "off") return;
    setTimeout(() => void this.check(), 15_000).unref();
    this.timer = setInterval(() => void this.check(), checkEvery);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private set(state: UpdateState) {
    this.state = state;
    this.emit(state);
  }

  async check() {
    const current = app.getVersion();
    if (this.state.status === "off" || this.busy) return this.state;
    // A download in progress or waiting for restart shouldn't be reset by a timer.
    if (["downloading", "ready", "installing"].includes(this.state.status))
      return this.state;
    this.install ??= await detectInstall();
    if (!this.install) {
      this.set({ status: "off", current });
      return this.state;
    }
    this.set({ status: "checking", current });
    try {
      const response = await net.fetch(this.feed, { cache: "no-store" });
      if (!response.ok)
        throw new Error(`The update feed answered ${response.status}.`);
      const manifest = manifestSchema.parse(await response.json());
      this.manifest = manifest;
      const file = manifest.files[this.install.target];
      if (!newerVersion(manifest.version, current) || !file) {
        this.set({ status: "idle", current, checkedAt: Date.now() });
      } else {
        this.set({
          status: "available",
          current,
          version: manifest.version,
          notes: manifest.notes,
          install: this.install.manual ? "manual" : "auto",
          ...(this.install.manual ? { reason: this.install.manual } : {}),
        });
      }
    } catch (error) {
      // Offline or a missing first release: stay out of the way until the next check.
      console.warn("Update check failed:", error);
      this.set({ status: "idle", current });
    }
    return this.state;
  }

  async download() {
    const { manifest, install } = this;
    const file = manifest && install && manifest.files[install.target];
    if (
      this.busy ||
      // A failed download retries straight from the error button.
      !["available", "error"].includes(this.state.status) ||
      !manifest ||
      !install ||
      install.manual ||
      !file
    )
      return this.state;
    this.busy = true;
    const current = app.getVersion(),
      version = manifest.version;
    const dir = join(app.getPath("temp"), `relay-update-${version}`);
    try {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = await this.fetchFile(file, dir, (progress) =>
        this.set({ status: "downloading", current, version, progress }),
      );
      this.staged = { version, path: await prepare(install.target, path, dir) };
      this.set({ status: "ready", current, version });
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      this.set({
        status: "error",
        current,
        version,
        message: error instanceof Error ? error.message : "Download failed.",
      });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  private async fetchFile(
    file: UpdateFile,
    dir: string,
    progress: (fraction: number) => void,
  ) {
    const response = await net.fetch(file.url, { cache: "no-store" });
    if (!response.ok || !response.body)
      throw new Error(`The download answered ${response.status}.`);
    const path = join(dir, file.name),
      hash = createHash("sha512"),
      output = createWriteStream(path, { mode: 0o600 });
    let received = 0,
      reported = 0;
    progress(0);
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.byteLength;
        if (!output.write(value))
          await new Promise<void>((r) => output.once("drain", () => r()));
        const fraction = Math.min(received / file.size, 1);
        if (fraction - reported >= 0.01) {
          reported = fraction;
          progress(fraction);
        }
      }
    } finally {
      await new Promise<void>((r) => output.end(() => r()));
    }
    if (received !== file.size || hash.digest("base64") !== file.sha512)
      throw new Error("The download didn't match the release. Try again.");
    return path;
  }

  /** Hands off to the platform installer, then quits; the new version starts by itself. */
  async installAndRestart() {
    const { staged, install } = this;
    if (this.state.status !== "ready" || !staged || !install) return this.state;
    const current = app.getVersion();
    this.set({ status: "installing", current, version: staged.version });
    try {
      await apply(install.target, staged.path);
      app.quit();
    } catch (error) {
      this.set({
        status: "error",
        current,
        version: staged.version,
        message: error instanceof Error ? error.message : "Update failed.",
      });
    }
    return this.state;
  }
}

/** Unpacks what needs unpacking while the app is still running normally. */
async function prepare(target: UpdateTarget, path: string, dir: string) {
  if (target === "mac-arm64" || target === "mac-x64") {
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

async function apply(target: UpdateTarget, staged: string) {
  switch (target) {
    case "mac-arm64":
    case "mac-x64": {
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
      // electron-builder's NSIS installer waits for Relay to exit and relaunches it.
      spawn(staged, ["--updated", "/S", "--force-run"], {
        detached: true,
        stdio: "ignore",
      }).unref();
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
      // The bundled installer replaces ~/.local/lib/review-relay-experimental in place.
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
