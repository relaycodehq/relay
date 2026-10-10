import { execFile, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { inSshSession, startOutsideSession } from "./outside-session";
import { headlessPaths } from "./paths";

const run = promisify(execFile);

/**
 * What starts Relay with the computer: launchd on macOS, systemd for this
 * user on Linux, and on Windows a script in the Startup folder that starts
 * it hidden at sign-in, with `relay run --supervise` restarting it as the
 * other two do.
 */
export type ServiceKind = "launchd" | "systemd" | "windows";

export const launchdLabel = "io.relaycode.relay";
const systemdUnit = "relay.service";

export interface ServiceSpec {
  node: string;
  script: string;
  home: string;
  /** The PATH the agents' CLIs were found on when the service was set up. */
  path: string;
}

/**
 * The Node.js to start Relay with: the `node` on PATH when it's this one,
 * since a package manager's versioned path (Homebrew's Cellar, say) is gone
 * after its next upgrade, and the link to it isn't.
 */
export function stableNode(
  execPath = process.execPath,
  path = process.env.PATH ?? "",
) {
  const real = (file: string) => {
    try {
      return realpathSync(file);
    } catch {
      return undefined;
    }
  };
  const running = real(execPath);
  for (const dir of path.split(delimiter).filter(Boolean)) {
    const candidate = join(
      dir,
      process.platform === "win32" ? "node.exe" : "node",
    );
    if (candidate !== execPath && real(candidate) === running) return candidate;
  }
  return execPath;
}

export function serviceKind(platform = process.platform): ServiceKind | null {
  return platform === "darwin"
    ? "launchd"
    : platform === "linux"
      ? "systemd"
      : platform === "win32"
        ? "windows"
        : null;
}

export function serviceFile(
  kind: ServiceKind,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
) {
  if (kind === "launchd")
    return join(home, "Library", "LaunchAgents", `${launchdLabel}.plist`);
  if (kind === "systemd")
    return join(home, ".config", "systemd", "user", systemdUnit);
  const roaming = env.APPDATA || join(home, "AppData", "Roaming");
  return join(
    roaming,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "Relay.vbs",
  );
}

const xml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Started at login and again after a crash, but not after `relay stop`:
 * stopping exits cleanly, which neither manager restarts, and restarting
 * after an update exits with launch.ts's `restartCode`, which both do. The
 * agent host is left alone when Relay stops, so agents keep working through
 * a restart.
 */
export function launchdPlist(spec: ServiceSpec) {
  const out = join(headlessPaths(spec.home).logs, "relay.out.log");
  const strings = (values: string[]) =>
    values.map((v) => `    <string>${xml(v)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchdLabel}</string>
  <key>ProgramArguments</key>
  <array>
${strings([spec.node, spec.script, "run", "--background"])}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>RELAY_HOME</key>
    <string>${xml(spec.home)}</string>
    <key>PATH</key>
    <string>${xml(spec.path)}</string>
    <key>RELAY_SERVICE</key>
    <string>launchd</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(out)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(out)}</string>
</dict>
</plist>
`;
}

const unitQuote = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

export function systemdService(spec: ServiceSpec) {
  const out = join(headlessPaths(spec.home).logs, "relay.out.log");
  return `[Unit]
Description=Relay, headless
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStart=${[spec.node, spec.script, "run", "--background"].map(unitQuote).join(" ")}
Environment=${unitQuote(`RELAY_HOME=${spec.home}`)}
Environment=${unitQuote(`PATH=${spec.path}`)}
Environment=RELAY_SERVICE=systemd
Restart=on-failure
RestartSec=5
# The agent host outlives Relay, as on the desktop, so agents keep working
# through a restart; it exits on its own once nobody needs it.
KillMode=process
StandardOutput=append:${out}
StandardError=append:${out}

[Install]
WantedBy=default.target
`;
}

const vbs = (text: string) => `"${text.replace(/"/g, '""')}"`;

/**
 * Starts Relay hidden at sign-in. Windows Script Host runs it, which reads
 * UTF-16 with a byte order mark, so any path can be in it.
 */
export function windowsLauncher(spec: ServiceSpec) {
  const command = [spec.node, spec.script]
    .map((part) => `""${part.replace(/"/g, '""')}""`)
    .join(" ");
  return `' Starts the headless Relay, hidden, when you sign in to Windows.
' Written by relay service install; relay service uninstall removes it.
Set shell = CreateObject("WScript.Shell")
Set env = shell.Environment("Process")
env("RELAY_HOME") = ${vbs(spec.home)}
env("PATH") = ${vbs(spec.path)}
env("RELAY_SERVICE") = "windows"
shell.CurrentDirectory = ${vbs(spec.home)}
shell.Run "${command} run --background --supervise", 0, False
`;
}

const utf16 = (text: string) =>
  Buffer.from(`\ufeff${text.replace(/\r?\n/g, "\r\n")}`, "utf16le");
const readUtf16 = (bytes: Buffer) =>
  bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.subarray(2).toString("utf16le")
    : bytes.toString("utf8");

/** Runs the Startup script now, as signing in would. */
async function launchWindows(file: string) {
  if (inSshSession()) {
    const wscript = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "wscript.exe",
    );
    await startOutsideSession(
      `"${wscript}" "${file}"`,
      dirname(file),
      process.env,
    );
    return;
  }
  spawn("wscript.exe", [file], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

/** The service Relay is set up as, if any. */
export function installedService(): ServiceKind | null {
  const kind = serviceKind();
  return kind && existsSync(serviceFile(kind)) ? kind : null;
}

/** The home folder the installed service runs Relay with. */
export async function serviceHome(kind: ServiceKind) {
  const text = await readFile(serviceFile(kind))
    .then(readUtf16)
    .catch(() => "");
  if (kind === "windows")
    return /^env\("RELAY_HOME"\) = "((?:[^"]|"")*)"\r?$/m
      .exec(text)?.[1]
      ?.replace(/""/g, '"');
  const found =
    kind === "launchd"
      ? /<key>RELAY_HOME<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1]
      : /^Environment="RELAY_HOME=(.*)"$/m.exec(text)?.[1];
  return found
    ?.replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

const uid = () => userInfo().uid;
/** launchd's domains for this user: the login session's, else the background one SSH gets. */
const domains = () => [`gui/${uid()}`, `user/${uid()}`];

async function launchctl(args: string[]) {
  return run("/bin/launchctl", args);
}

async function systemctl(args: string[]) {
  return run("systemctl", ["--user", ...args]);
}

/** Writes the service and starts it; replaces one set up before. */
export async function installService(spec: ServiceSpec) {
  const kind = serviceKind();
  if (!kind)
    throw new Error(
      "Relay can't set itself up as a service here. Run `relay start` after each restart instead.",
    );
  const file = serviceFile(kind);
  await mkdir(dirname(file), { recursive: true });
  await mkdir(headlessPaths(spec.home).logs, { recursive: true, mode: 0o700 });
  if (kind === "windows") {
    await writeFile(file, utf16(windowsLauncher(spec)));
    await launchWindows(file);
    return {
      kind,
      file,
      note: "Relay starts when you sign in to Windows. On a computer nobody signs in to, turn on automatic sign-in for this account.",
    };
  }
  if (kind === "launchd") {
    await uninstallLaunchd({ keepFile: true });
    await writeFile(file, launchdPlist(spec));
    let last: unknown;
    for (const domain of domains())
      try {
        await launchctl(["bootstrap", domain, file]);
        return { kind, file, note: undefined };
      } catch (e) {
        last = e;
      }
    throw new Error(`launchd wouldn't load Relay: ${message(last)}`);
  }
  await writeFile(file, systemdService(spec));
  await systemctl(["daemon-reload"]);
  // Enabling an active unit does not apply a changed home or executable.
  await systemctl(["enable", systemdUnit]);
  await systemctl(["restart", systemdUnit]);
  // Without lingering, a user's services stop when their last session ends.
  const note = await run("loginctl", ["enable-linger", userInfo().username])
    .then(() => undefined)
    .catch(
      () =>
        `To keep Relay running after you log out, run: sudo loginctl enable-linger ${userInfo().username}`,
    );
  return { kind, file, note };
}

export async function uninstallService() {
  const kind = installedService();
  if (!kind) return null;
  if (kind === "launchd") await uninstallLaunchd({ keepFile: false });
  else if (kind === "windows") await rm(serviceFile(kind), { force: true });
  else {
    await systemctl(["disable", "--now", systemdUnit]).catch(() => {});
    await rm(serviceFile(kind), { force: true });
    await systemctl(["daemon-reload"]).catch(() => {});
  }
  return kind;
}

async function uninstallLaunchd({ keepFile }: { keepFile: boolean }) {
  for (const domain of domains())
    await launchctl(["bootout", `${domain}/${launchdLabel}`]).catch(() => {});
  if (!keepFile) await rm(serviceFile("launchd"), { force: true });
}

/** Asks the service manager to start Relay; false when it isn't set up as a service. */
export async function startService() {
  const kind = installedService();
  if (!kind) return false;
  if (kind === "windows") {
    await launchWindows(serviceFile(kind));
    return true;
  }
  if (kind === "systemd") {
    await systemctl(["start", systemdUnit]);
    return true;
  }
  for (const domain of domains())
    try {
      await launchctl(["kickstart", `${domain}/${launchdLabel}`]);
      return true;
    } catch {
      // Not loaded in this domain; try the next, then load it.
    }
  let last: unknown;
  for (const domain of domains())
    try {
      await launchctl(["bootstrap", domain, serviceFile("launchd")]);
      return true;
    } catch (e) {
      last = e;
    }
  throw new Error(`launchd wouldn't start Relay: ${message(last)}`);
}

const message = (e: unknown) =>
  e instanceof Error
    ? (e as Error & { stderr?: string }).stderr?.trim() || e.message
    : String(e);
