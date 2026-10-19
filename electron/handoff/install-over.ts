// Installs the headless Relay on a computer a route reaches, over that same
// ssh or wsl.exe, as VS Code puts its server on a remote: the installer this
// Relay ships runs there from stdin, as the user, into their home folder, and
// brings Node.js along when the computer has none new enough.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ComputerRoute } from "../../shared/handoff";
import { routeName, routeShell } from "./pipe-route";

/** Downloads of Relay and maybe Node.js on a slow line, and no more. */
const installTimeout = 10 * 60_000;
/** What each route's install has printed, the end of it, while it runs and after. */
const outputs = new Map<string, string>();

const keyOf = (route: ComputerRoute) =>
  route.kind === "ssh" ? `ssh:${route.host}` : `wsl:${route.distro}`;

/** Beside the bundle once built (scripts/build-electron.mjs), else the source. */
function installer() {
  for (const path of [
    join(__dirname, "install-relay.sh"),
    resolve("packaging/headless/install.sh"),
  ])
    if (existsSync(path)) return readFileSync(path, "utf8");
  throw new Error("This Relay can't install Relay on other computers.");
}

export const installOutput = (route: ComputerRoute) =>
  outputs.get(keyOf(route)) ?? "";

export function installRelayOver(
  route: ComputerRoute,
  { command = routeShell, script = installer() } = {},
) {
  const key = keyOf(route);
  outputs.set(key, "");
  // No terminal there to run `relay setup` in; pairing does what it would.
  const [file, args] = command(route, "env RELAY_NO_SETUP=1 sh -s");
  return new Promise<void>((done, fail) => {
    const child = spawn(file, args, { stdio: "pipe", windowsHide: true });
    let output = "";
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-20_000);
      outputs.set(key, output);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill(), installTimeout);
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      fail(
        e.code === "ENOENT"
          ? new Error(`There's no ${file} on this computer.`)
          : e,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return done();
      // The installer's last line says why, as it would in a terminal.
      const last = output.trim().split(/\r?\n/).at(-1)?.trim();
      fail(
        new Error(
          last || `Installing Relay over ${routeName(route)} didn't finish.`,
        ),
      );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(script);
  });
}
