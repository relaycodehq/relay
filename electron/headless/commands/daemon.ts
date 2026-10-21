import { spawn } from "node:child_process";
import { connect } from "node:net";
import { existsSync, openSync, readSync, statSync, closeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeReady } from "../../../shared/handoff";
import { callControl, type DaemonStatus } from "../control";
import { bold, dim, ok, warn } from "../format";
import {
  AlreadyRunning,
  alreadyRunningCode,
  readConfig,
  restartCode,
  running,
  saveConfig,
  startDetached,
  stopped,
} from "../launch";
import { headlessPaths } from "../paths";
import { installedService } from "../service";
import { type Flags } from "./args";
import { script, printJson } from "./util";
import { sleep } from "../../util/sleep";

// Running Relay in the background here: start, stop, status, logs.

export async function run(home: string, flags: Flags) {
  if (flags.supervise) return supervise(home);
  const already = await running(home);
  if (already)
    throw new AlreadyRunning(
      `Relay is already running here (pid ${already.pid}).`,
    );
  await remember(home, flags);
  const config = await readConfig(home);
  const port =
    config.port ?? (Number(process.env.RELAY_REMOTE_PORT) || undefined);
  // Its own bundle, so the commands that only ask it something start quickly.
  const daemon = require(
    join(__dirname, "relay-daemon.cjs"),
  ) as typeof import("../daemon");
  daemon.logTo(headlessPaths(home).log, { echo: !flags.background });
  await daemon.runDaemon({
    home,
    ...(port ? { port } : {}),
    ...(config.name ? { name: config.name } : {}),
  });
}

/**
 * Runs Relay and starts it again when it crashes or restarts for an update,
 * as launchd and systemd do elsewhere; Windows' Startup script runs this.
 * A clean exit (`relay stop`) or another Relay already running ends it.
 */
export async function supervise(home: string) {
  let wait = 1000;
  for (;;) {
    const started = Date.now();
    const code = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [script, "run", "--background"], {
        cwd: home,
        stdio: "inherit",
        windowsHide: true,
        env: { ...process.env, RELAY_HOME: home },
      });
      child.once("error", () => resolve(1));
      child.once("exit", (exit) => resolve(exit ?? 1));
    });
    if (code === 0 || code === alreadyRunningCode) return;
    if (code === restartCode) {
      wait = 1000;
      continue;
    }
    // A Relay that ran a while before failing gets the short wait again.
    if (Date.now() - started > 60_000) wait = 1000;
    console.error(
      `Relay exited (${code}); starting it again in ${wait / 1000}s.`,
    );
    await sleep(wait);
    wait = Math.min(wait * 2, 60_000);
  }
}

/** Keeps `--port` and `--name` for every start after this one. */
export async function remember(home: string, flags: Flags) {
  if (flags.port || flags.name)
    await saveConfig(home, {
      ...(flags.port ? { port: flags.port } : {}),
      ...(flags.name ? { name: flags.name } : {}),
    });
}

/** The running Relay's status, starting it in the background first if it isn't. */
export async function ensureRunning(home: string, flags: Flags, quiet = false) {
  const status = await running(home);
  if (status) return status;
  if (!quiet && !flags.json)
    console.log(dim("Starting Relay in the background…"));
  return (await startDetached(home, script)).status;
}

/**
 * Carries a paired computer's bridge over stdin and stdout, for a computer
 * that reaches this one over SSH or wsl.exe instead of the network; Relay
 * starts first if it isn't running. Nothing but `pipeReady` and then its
 * bytes goes to stdout.
 */
export async function pipe(home: string, flags: Flags) {
  let status = await ensureRunning(home, { ...flags, json: true }, true);
  // Just started, it may not listen yet.
  for (let i = 0; i < 100 && !status.remote.bound; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    status = (await running(home)) ?? status;
  }
  const { bound, port } = status.remote;
  if (!bound)
    throw new Error(
      status.remote.enabled
        ? `Relay isn't listening: ${status.remote.error ?? "it didn't start its bridge."}`
        : "Phone and computer access is off here; relay pair turns it on.",
    );
  const socket = connect({
    host: bound === "0.0.0.0" ? "127.0.0.1" : bound,
    port,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  process.stdout.write(pipeReady);
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  process.stdin.once("end", () => socket.end());
  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  process.stdin.destroy();
}

export async function start(home: string, flags: Flags) {
  await remember(home, flags);
  const already = await running(home);
  if (already) {
    if (flags.json) return printJson(already);
    console.log(ok(`Relay is already running (pid ${already.pid}).`));
    if (flags.port || flags.name)
      console.log(`Saved; ${bold("relay restart")} puts it to use.`);
    return;
  }
  const { status, via } = await startDetached(home, script);
  if (flags.json) return printJson(status);
  console.log(
    ok(
      `Relay ${status.version} is running in the background${via === "service" ? " as a service" : ""} (pid ${status.pid}).`,
    ),
  );
  printReach(status);
  if (!status.remote.devices.length)
    console.log(`\nPair your phone with ${bold("relay pair")}.`);
}

export async function stop(home: string, flags: Flags) {
  const status = await running(home);
  if (!status) return console.log("Relay isn't running.");
  await callControl(headlessPaths(home).control, "stop", {
    force: flags.force,
  });
  await stopped(home);
  console.log(ok("Relay stopped."));
  if (installedService())
    console.log(
      dim(
        "It starts again with the computer; `relay service uninstall` stops that.",
      ),
    );
}

export async function restart(home: string, flags: Flags) {
  await remember(home, flags);
  if (await running(home)) {
    await callControl(headlessPaths(home).control, "stop", { detach: true });
    await stopped(home);
  }
  const { status } = await startDetached(home, script);
  console.log(ok(`Relay ${status.version} restarted (pid ${status.pid}).`));
  printReach(status);
}

function printReach(status: DaemonStatus) {
  const { remote } = status;
  if (remote.listening)
    console.log(
      `Phones and computers reach it at ${bold(`${remote.hosts.join(", ")}:${remote.port}`)} ${reachWay(status)}.`,
    );
  else if (remote.bound) console.log(ok(`${pipeOnly(status)}.`));
  else console.log(warn(`Not reachable yet: ${reachProblem(status)}`));
}

/** How phones and computers get to the addresses it listens on. */
export function reachWay({ remote }: DaemonStatus) {
  const tailnet = remote.hosts.filter((host) =>
    remote.tailnet.addresses.includes(host),
  ).length;
  const name = remote.tailnet.name ? ` (${remote.tailnet.name})` : "";
  if (!tailnet) return "on the local network";
  return tailnet === remote.hosts.length
    ? `over Tailscale${name}`
    : `on the local network and over Tailscale${name}`;
}

/** Neither Tailscale nor the local network: only `relay pipe`, through ssh or wsl.exe, gets in. */
export const pipeOnly = (status: DaemonStatus) =>
  `Computers reach it only through ssh, or wsl.exe from Windows (${reachProblem(status).replace(/\.$/, "")})`;

export function reachProblem({ remote }: DaemonStatus) {
  if (remote.error) return remote.error;
  if (remote.tailnet.status === "missing") return "Tailscale isn't installed.";
  if (remote.tailnet.status === "stopped")
    return "Tailscale is off; run `tailscale up`.";
  if (!remote.enabled) return "phone access is off; `relay pair` turns it on.";
  return "waiting for Tailscale.";
}

export async function logs(home: string, flags: Flags) {
  const { log } = headlessPaths(home);
  if (!existsSync(log)) return console.log(`No log yet at ${log}.`);
  const text = await readFile(log, "utf8");
  const lines = text.trimEnd().split("\n");
  console.log(lines.slice(-(flags.lines ?? 80)).join("\n"));
  if (!flags.follow) return;
  let at = statSync(log).size;
  setInterval(() => {
    let size: number;
    try {
      size = statSync(log).size;
    } catch {
      return;
    }
    // The log started over.
    if (size < at) at = 0;
    if (size === at) return;
    const fd = openSync(log, "r");
    const buffer = Buffer.alloc(size - at);
    readSync(fd, buffer, 0, buffer.length, at);
    closeSync(fd);
    at = size;
    process.stdout.write(buffer);
  }, 500);
  await new Promise(() => {});
}

// ── Pairing ────────────────────────────────────────────────────────────

export async function needRunning(home: string) {
  const status = await running(home);
  if (!status)
    throw new Error("Relay isn't running. Start it with `relay start`.");
  return status;
}

// ── Service and setup ──────────────────────────────────────────────────
