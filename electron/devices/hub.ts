import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { DeviceHubState, DeviceHubStatus } from "../../shared/devices";
import { findExecutable, runExecutable } from "../platform/executables";
import { stopProcessTree } from "../platform/terminate";

/**
 * Pinned: the hub is 0.x and ships canaries daily. Old enough to pass an npm
 * `min-release-age` of a few days.
 */
export const HUB_VERSION = "0.15.1";
const PACKAGE = "expo-device-hub";
const INSTALL_TIMEOUT = 5 * 60_000;
const READY_TIMEOUT = 30_000;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface RunningHub {
  origin: string;
  token: string;
}

/** Where an Android SDK is, from the usual variables and default folders. */
export async function androidSdk(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
): Promise<string | undefined> {
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    platform === "darwin"
      ? join(home, "Library", "Android", "sdk")
      : platform === "win32"
        ? env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Android", "Sdk")
        : join(home, "Android", "Sdk"),
  ];
  for (const dir of candidates) {
    if (!dir) continue;
    const adb = join(dir, "platform-tools", platform === "win32" ? "adb.exe" : "adb");
    if (await access(adb).then(() => true, () => false)) return dir;
  }
  return undefined;
}

/** The hub finds `adb` and `emulator` on PATH, so the SDK's folders go first. */
export function hubEnv(
  env: NodeJS.ProcessEnv,
  sdk: string | undefined,
): NodeJS.ProcessEnv {
  if (!sdk) return { ...env };
  const dirs = [join(sdk, "platform-tools"), join(sdk, "emulator")];
  return {
    ...env,
    ANDROID_HOME: sdk,
    PATH: [...dirs, env.PATH].filter(Boolean).join(delimiter),
  };
}

/** The session token the hub prints in its startup link. */
export function tokenIn(output: string): string | undefined {
  return /[?&]token=([\w-]{16,})/.exec(output)?.[1];
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("No free port for the device hub.")),
      );
    });
  });

async function hasXcode(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const xcrun = await findExecutable("xcrun").catch(() => undefined);
  if (!xcrun) return false;
  const found = await runExecutable(xcrun, ["--find", "simctl"], 10_000).catch(
    () => undefined,
  );
  return found?.code === 0;
}

/**
 * Runs the hub for the desktop: downloaded into `dir` with the user's own
 * npm the first time someone asks, then started on a loopback port that
 * needs its token. It stops with Relay; the simulators it booted don't.
 */
export class DeviceHub {
  private status: DeviceHubStatus = "absent";
  private error?: string;
  private platforms = { android: false, ios: false };
  private child?: ChildProcess;
  private running?: RunningHub;
  private starting?: Promise<RunningHub>;
  private disposed = false;

  constructor(
    private dir: string,
    private changed: () => void,
    private fetch: Fetch,
  ) {}

  private get home() {
    return join(this.dir, HUB_VERSION);
  }
  private get entry() {
    return join(this.home, "node_modules", PACKAGE, "dist", "server", "cli.mjs");
  }

  async state(): Promise<Omit<DeviceHubState, "snapshot">> {
    if (this.status === "absent" || this.status === "stopped")
      this.status = (await this.installed()) ? "stopped" : "absent";
    return {
      status: this.status,
      version: HUB_VERSION,
      platforms: this.platforms,
      ...(this.error && { error: this.error }),
    };
  }

  /** Where the hub answers, started and downloaded as needed. */
  start(): Promise<RunningHub> {
    if (this.running) return Promise.resolve(this.running);
    this.starting ??= this.boot().finally(() => (this.starting = undefined));
    return this.starting;
  }

  private installed() {
    return access(this.entry).then(
      () => true,
      () => false,
    );
  }

  private set(status: DeviceHubStatus, error?: string) {
    this.status = status;
    this.error = error;
    this.changed();
  }

  private async boot(): Promise<RunningHub> {
    try {
      const sdk = await androidSdk();
      this.platforms = { android: !!sdk, ios: await hasXcode() };
      if (!this.platforms.android && !this.platforms.ios)
        throw new Error(
          process.platform === "darwin"
            ? "No Android SDK or Xcode found. Install Android Studio (or set ANDROID_HOME), or Xcode, then try again."
            : "No Android SDK found. Install Android Studio, or set ANDROID_HOME, then try again.",
        );
      if (!(await this.installed())) await this.install();
      const node = await findExecutable("node").catch(() => {
        throw new Error("The device hub runs on Node.js. Install Node.js, then try again.");
      });
      this.set("starting");
      const hub = await this.launch(node, hubEnv(process.env, sdk));
      if (this.disposed) throw new Error("Relay is quitting.");
      this.running = hub;
      this.set("running");
      return hub;
    } catch (e) {
      this.set("failed", e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  private async install() {
    this.set("installing");
    const npm = await findExecutable("npm").catch(() => {
      throw new Error("The device hub installs through npm. Install Node.js, then try again.");
    });
    // A failed install would otherwise pass for one next time.
    await rm(this.home, { recursive: true, force: true });
    await mkdir(this.home, { recursive: true });
    const run = await runExecutable(
      npm,
      [
        "install",
        "--prefix",
        this.home,
        "--no-save",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        `${PACKAGE}@${HUB_VERSION}`,
      ],
      INSTALL_TIMEOUT,
    );
    if (run.code === 0 && (await this.installed())) return;
    await rm(this.home, { recursive: true, force: true });
    throw new Error(
      run.timedOut
        ? "Downloading the device hub took too long."
        : `npm couldn't install ${PACKAGE}@${HUB_VERSION}:\n${run.output.trim().slice(-1500)}`,
    );
  }

  private async launch(node: string, env: NodeJS.ProcessEnv): Promise<RunningHub> {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(
      node,
      [
        this.entry,
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--require-token",
      ],
      // Its own process group, so stopping it takes the streamers it starts too.
      {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      },
    );
    this.child = child;
    let output = "";
    let token: string | undefined;
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000);
      token ??= tokenIn(output);
    };
    child.stdout!.on("data", read);
    child.stderr!.on("data", read);
    const exited = new Promise<never>((_, reject) =>
      child.once("exit", (code) => {
        reject(
          new Error(
            `The device hub stopped (exit ${code ?? "signal"}):\n${output.trim().slice(-1500)}`,
          ),
        );
      }),
    );
    exited.catch(() => {});
    child.once("exit", () => {
      if (this.child !== child) return;
      this.child = this.running = undefined;
      if (!this.disposed && this.status === "running")
        this.set("failed", "The device hub stopped. Start it again to keep watching.");
    });
    const deadline = Date.now() + READY_TIMEOUT;
    while (Date.now() < deadline) {
      const ready = await this.fetch(`${origin}/readyz`).then(
        (r) => r.ok,
        () => false,
      );
      if (ready && token) return { origin, token };
      await Promise.race([exited, new Promise((r) => setTimeout(r, 250))]);
    }
    await stopProcessTree(child).catch(() => {});
    throw new Error("The device hub didn't start in time.");
  }

  async dispose() {
    this.disposed = true;
    const child = this.child;
    this.child = this.running = undefined;
    if (child) await stopProcessTree(child).catch(() => {});
  }
}
