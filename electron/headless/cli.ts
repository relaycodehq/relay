// The `relay` command: sets a headless Relay up once, keeps it running in
// the background and shows the codes phones and other computers pair with.
// The work itself happens on those; nothing here is a terminal UI for it.
import { fail } from "./format";
import { AlreadyRunning, alreadyRunningCode } from "./launch";
import { errorMessage } from "../../shared/error-message";
import { Quiet } from "./commands/util";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { relayCommands } from "../app/open-folder";
import { relayHome } from "./paths";
import { settingsCommand } from "./settings";
import { headlessVersion } from "./version";
import { Usage, parse, help } from "./commands/args";
import {
  run,
  ensureRunning,
  pipe,
  start,
  stop,
  restart,
  logs,
} from "./commands/daemon";
import { service, uninstall, setup, update } from "./commands/install";
import {
  status,
  pair,
  projects,
  threads,
  devices,
  call,
} from "./commands/remote";
import { minimumNode, desktopAppId } from "./commands/util";

export const commands = new Set<string>(relayCommands);

export async function main(argv: string[]) {
  const { flags, words } = parse(argv);
  if (flags.version) return console.log(headlessVersion);
  const [command = flags.help ? "help" : "help", ...rest] = words;
  if (flags.help || command === "help") return console.log(help);
  if (!commands.has(command) && isFolder(command))
    return openInDesktop(resolve(command));
  const major = Number(process.versions.node.split(".")[0]);
  if (major < minimumNode)
    throw new Error(
      `Relay needs Node.js ${minimumNode} or newer; this is ${process.versions.node}.`,
    );
  const requestedHome = resolve(flags.home ?? relayHome());
  const home = await realpath(requestedHome).catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return requestedHome;
      throw e;
    },
  );
  // The background Relay and everything it starts read their home from here.
  process.env.RELAY_HOME = home;
  switch (command) {
    case "run":
      return run(home, flags);
    case "start":
      return start(home, flags);
    case "stop":
      return stop(home, flags);
    case "restart":
      return restart(home, flags);
    case "status":
      return status(home, flags);
    case "pair":
      return pair(home, flags);
    case "pipe":
      return pipe(home, flags);
    case "logs":
      return logs(home, flags);
    case "projects":
    case "project":
      return projects(home, flags, rest);
    case "threads":
      return threads(home, flags);
    case "devices":
    case "device":
      return devices(home, flags, rest);
    case "service":
      return service(home, flags, rest);
    case "setup":
      return setup(home, flags);
    case "version":
      return console.log(headlessVersion);
    case "update":
      return update(home, flags);
    case "uninstall":
      return uninstall(home, flags);
    case "settings":
    case "config":
      await ensureRunning(home, flags);
      return settingsCommand(
        {
          home,
          json: flags.json,
          restart: async () => {
            await restart(home, { ...flags, port: undefined, name: undefined });
          },
        },
        rest,
      );
    case "call":
      return call(home, rest);
    default:
      throw new Usage(`Unknown command “${command}”. See relay --help.`);
  }
}

function isFolder(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Opens `folder` as a project in the desktop app, the way `relay .` does where that's installed. */
function openInDesktop(folder: string) {
  if (process.platform !== "darwin")
    throw new Error(
      "This is the headless Relay; it can't open folders. To work in one here, run relay projects add <folder> and start threads from your phone or another computer.",
    );
  try {
    execFileSync("open", ["-b", desktopAppId, folder], { stdio: "ignore" });
  } catch {
    throw new Error(
      "Relay's desktop app isn't installed on this Mac: https://relaycode.io/download",
    );
  }
}

// ── Running ────────────────────────────────────────────────────────────

main(process.argv.slice(2)).catch((e) => {
  if (!(e instanceof Quiet))
    console.error(e instanceof Usage ? `${e.message}` : fail(errorMessage(e)));
  process.exit(
    e instanceof Usage
      ? 2
      : e instanceof AlreadyRunning
        ? alreadyRunningCode
        : 1,
  );
});
