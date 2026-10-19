// The `relay` command: sets a headless Relay up once, keeps it running in
// the background and shows the codes phones and other computers pair with.
// The work itself happens on those; nothing here is a terminal UI for it.
import { execFileSync, spawn } from "node:child_process";
import { connect } from "node:net";
import { existsSync, openSync, readSync, statSync, closeSync } from "node:fs";
import { lstat, readFile, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { relayCommands } from "../app/open-folder";
import { tailnetProbe } from "../remote/tailscale";
import { agentInfo, type AgentProvider } from "../../shared/agents";
import { callControl, type DaemonStatus, type ThreadRow } from "./control";
import {
  ago,
  bold,
  clip,
  colorful,
  cyan,
  dim,
  duration,
  fail,
  green,
  ok,
  red,
  table,
  warn,
  yellow,
} from "./format";
import {
  AlreadyRunning,
  alreadyRunningCode,
  autoUpdateEnabled,
  readConfig,
  restartCode,
  running,
  saveConfig,
  startDetached,
  stopped,
  stopForService,
} from "./launch";
import { headlessPaths, relayHome } from "./paths";
import { settingsCommand } from "./settings";
import { terminalQr } from "./qr";
import { indent, row, Screen, section } from "./terminal-ui";
import {
  installService,
  installedService,
  serviceFile,
  serviceHome,
  stableNode,
  uninstallService,
} from "./service";
import { HeadlessUpdater, installRoot } from "./updater";
import { headlessVersion } from "./version";
import { keepDistributionsUp, wslDistro } from "./wsl";

const agentName = (provider: string) =>
  agentInfo(provider as AgentProvider)?.cli ?? provider;

/** This bundle; the service and background starts run it again. */
const script = __filename;
const minimumNode = 22;
/** The desktop app's bundle id, which `relay <folder>` opens on macOS. */
const desktopAppId = "dev.relay.experimental";

interface Flags {
  home?: string;
  port?: number;
  name?: string;
  json: boolean;
  force: boolean;
  follow: boolean;
  yes: boolean;
  purge: boolean;
  service: boolean;
  pair: boolean;
  background: boolean;
  supervise: boolean;
  help: boolean;
  version: boolean;
  projects: string[];
  lines?: number;
  check: boolean;
  /** `relay pair` for a computer pairing over SSH or wsl.exe. */
  pipe: boolean;
}

class Usage extends Error {}

function parse(argv: string[]) {
  const flags: Flags = {
    json: false,
    force: false,
    follow: false,
    yes: false,
    purge: false,
    service: true,
    pair: true,
    background: false,
    supervise: false,
    help: false,
    version: false,
    projects: [],
    check: false,
    pipe: false,
  };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [name, inline] = arg.startsWith("--")
      ? arg.split(/=(.*)/s, 2)
      : [arg];
    const value = () => {
      const next = inline ?? argv[++i];
      if (next === undefined || (inline === undefined && next.startsWith("-")))
        throw new Usage(`${name} needs a value.`);
      return next;
    };
    switch (name) {
      case "--home": {
        const home = value();
        if (!home.trim()) throw new Usage("--home needs a nonempty path.");
        flags.home = home;
        break;
      }
      case "--port": {
        const port = Number(value());
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new Usage("--port takes a number from 1 to 65535.");
        flags.port = port;
        break;
      }
      case "--name": {
        const name = value().trim();
        if (!name || name.length > 80)
          throw new Usage("--name takes a name of up to 80 characters.");
        flags.name = name;
        break;
      }
      case "--project":
        flags.projects.push(value());
        break;
      case "-n":
      case "--lines":
        flags.lines = Math.max(1, Number(value()) || 80);
        break;
      case "--json":
        flags.json = true;
        break;
      case "--pipe":
        flags.pipe = true;
        break;
      case "--force":
        flags.force = true;
        break;
      case "-f":
      case "--follow":
        flags.follow = true;
        break;
      case "-y":
      case "--yes":
        flags.yes = true;
        break;
      case "--purge":
        flags.purge = true;
        break;
      case "--no-service":
        flags.service = false;
        break;
      case "--check":
        flags.check = true;
        break;
      case "--no-pair":
        flags.pair = false;
        break;
      case "--background":
        flags.background = true;
        break;
      case "--supervise":
        flags.supervise = true;
        break;
      case "-h":
      case "--help":
        flags.help = true;
        break;
      case "-v":
      case "--version":
        flags.version = true;
        break;
      default:
        if (arg.startsWith("-") && arg !== "-")
          throw new Usage(`Unknown option ${arg}.`);
        words.push(arg);
    }
  }
  return { flags, words };
}

const help = `${bold("relay")} — your agents on this computer, reached from your phone and your other computers.

Set it up once; it runs in the background and starts with the computer.
Threads are started, followed and handed over from the Relay phone app or
the Relay desktop app on another computer.

${bold("Getting started")}
  relay setup                  Check this computer, run Relay at every start, pair a phone
  relay pair                   Show a code to pair a phone or another computer
  relay <folder>               On a Mac, open a folder in Relay's desktop app (relay .)

${bold("Running")}
  relay status                 What runs, where phones reach it, who is paired
  relay start                  Start Relay in the background
  relay stop [--force]         Stop it; refuses while threads work unless --force
  relay restart                Restart it; agents keep working through it
  relay logs [-f] [-n <lines>] Show the log; -f follows it
  relay update [--check]       Install the newest release; agents keep working through it
  relay run                    Run in the foreground (what the service runs)
  relay pipe                   Carry another computer's connection over stdin and stdout
                               (what \`ssh <host> relay pipe\` and wsl.exe run)
  relay uninstall [--purge]    Stop Relay and remove it; --purge deletes its data too

${bold("Settings")}
  relay settings               Change settings in a menu; set up dictation, read aloud,
                               Cursor and Gitea for this computer
  relay settings set <key> <value>   The same from a script; relay settings lists the keys

${bold("Projects and threads")}
  relay projects               List projects
  relay projects add <folder>  Add a folder (a Git checkout) as a project
  relay projects remove <name> Hide a project; its folder and threads stay
  relay threads                List threads and what each is doing

${bold("Paired devices")}
  relay devices                List paired phones and computers
  relay devices remove <name>  Unpair one; it's disconnected at once

${bold("Background service")}
  relay service install        Start Relay with the computer (launchd or systemd)
  relay service uninstall      Stop starting it with the computer
  relay service status         Whether it's set up

${bold("Options")}
  --home <folder>  Where Relay keeps its data (default ~/.relay, or RELAY_HOME)
  --port <number>  The port phones and computers connect to (default 47821)
  --name <name>    What phones and other computers call this one (default: its host name)
  --json           Print machine-readable output
`;

const commands = new Set<string>(relayCommands);

async function main(argv: string[]) {
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

async function run(home: string, flags: Flags) {
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
  ) as typeof import("./daemon");
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
async function supervise(home: string) {
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
async function remember(home: string, flags: Flags) {
  if (flags.port || flags.name)
    await saveConfig(home, {
      ...(flags.port ? { port: flags.port } : {}),
      ...(flags.name ? { name: flags.name } : {}),
    });
}

/** The running Relay's status, starting it in the background first if it isn't. */
async function ensureRunning(home: string, flags: Flags, quiet = false) {
  const status = await running(home);
  if (status) return status;
  if (!quiet && !flags.json)
    console.log(dim("Starting Relay in the background…"));
  return (await startDetached(home, script)).status;
}

/**
 * Carries a paired computer's bridge over stdin and stdout, for a computer
 * that reaches this one over SSH or wsl.exe instead of the network; Relay
 * starts first if it isn't running. Nothing but its bytes goes to stdout.
 */
async function pipe(home: string, flags: Flags) {
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
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  process.stdin.once("end", () => socket.end());
  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  process.stdin.destroy();
}

async function start(home: string, flags: Flags) {
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

async function stop(home: string, flags: Flags) {
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

async function restart(home: string, flags: Flags) {
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
function reachWay({ remote }: DaemonStatus) {
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
const pipeOnly = (status: DaemonStatus) =>
  `Computers reach it only through ssh, or wsl.exe from Windows (${reachProblem(status).replace(/\.$/, "")})`;

function reachProblem({ remote }: DaemonStatus) {
  if (remote.error) return remote.error;
  if (remote.tailnet.status === "missing") return "Tailscale isn't installed.";
  if (remote.tailnet.status === "stopped")
    return "Tailscale is off; run `tailscale up`.";
  if (!remote.enabled) return "phone access is off; `relay pair` turns it on.";
  return "waiting for Tailscale.";
}

async function status(home: string, flags: Flags) {
  const status = await running(home);
  const kind = installedService();
  const serviceHomeMatches = kind ? (await serviceHome(kind)) === home : false;
  if (flags.json)
    return printJson({
      running: !!status,
      service: kind && serviceHomeMatches ? kind : null,
      ...(status ? { status } : {}),
    });
  if (!status) {
    console.log(`${red("●")} Relay isn't running ${dim(`(${home})`)}`);
    console.log(
      kind && serviceHomeMatches
        ? `Its service is set up; start it with ${bold("relay start")}.`
        : `Start it with ${bold("relay start")}, or set it up with ${bold("relay setup")}.`,
    );
    return;
  }
  const { remote, threads } = status;
  const ui = new Screen();
  const head = `● Relay ${status.version}`;
  ui.print(
    `\n ${green("●")} ${bold(`Relay ${status.version}`)}${" ".repeat(Math.max(2, 44 - head.length))}${dim(`running for ${duration(Date.now() - status.startedAt)} · pid ${status.pid}`)}`,
  );

  ui.print(section("This computer"));
  ui.print(row("ok", "Name", dim(status.name)));
  ui.print(
    remote.listening
      ? row(
          "ok",
          "Reach",
          dim(`${remote.hosts.join(", ")}:${remote.port} ${reachWay(status)}`),
        )
      : remote.bound
        ? row("ok", "Reach", dim(pipeOnly(status)))
        : row("warn", "Reach", `not reachable: ${reachProblem(status)}`),
  );
  ui.print(row("ok", "Data", dim(tilde(status.home))));
  ui.print(
    kind && serviceHomeMatches
      ? row(
          "ok",
          "Service",
          dim(`${kind}, ${kind === "windows" ? "starts when you sign in" : "starts with the computer"}`),
        )
      : row("off", "Service", "not set up; relay service install starts Relay with the computer"),
  );
  const auto = await autoUpdateEnabled(home);
  ui.print(
    status.update.status === "off"
      ? row("off", "Updates", "built from source; git pull updates it")
      : status.update.status === "available"
        ? row(
            "warn",
            "Updates",
            auto
              ? `Relay ${status.update.version} is out; it installs once no thread is working`
              : `Relay ${status.update.version} is out; relay update installs it`,
          )
        : auto
          ? row("ok", "Updates", dim("installed by themselves"))
          : row("off", "Updates", "off; relay update installs one"),
  );

  ui.print(section("Paired"));
  for (const d of remote.devices) ui.print(deviceRow(d));
  if (!remote.devices.length)
    ui.print(row("off", "Nothing yet", "relay pair shows a code for a phone or computer"));

  ui.print(section("Work"));
  ui.print(
    row(
      threads.waiting ? "warn" : "ok",
      "Threads",
      [
        threads.working ? cyan(`${threads.working} working`) : "",
        threads.waiting ? yellow(`${threads.waiting} waiting on you`) : "",
        dim(`${threads.total} in all`),
      ]
        .filter(Boolean)
        .join(dim(" · ")),
    ),
  );
  ui.print(
    row(
      status.projects ? "ok" : "off",
      "Projects",
      status.projects ? dim(String(status.projects)) : "none yet; relay projects add <folder>",
    ),
  );

  ui.print(section("Agents"));
  if (!status.agents.length) ui.print(row("off", "Checking…"));
  const agents = status.agents.filter((a) => a.provider !== "cursor");
  for (const a of agents.filter((a) => a.path))
    ui.print(
      a.account && !a.account.signedIn
        ? row("warn", agentName(a.provider), `signed out; sign in once with ${bold(signIn(a.provider))}`)
        : row("ok", agentName(a.provider), dim(a.current ?? "")),
    );
  const missing = agents.filter((a) => !a.path).map((a) => agentName(a.provider));
  if (missing.length) ui.print(row("off", "Not found", missing.join(", ")));
  ui.print("");
}

async function logs(home: string, flags: Flags) {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pair(
  home: string,
  flags: Flags,
  waitForDevice = true,
  ui = new Screen(),
) {
  const status = await ensureRunning(home, flags);
  const control = headlessPaths(home).control;
  let pairing;
  try {
    pairing = await callControl(control, "pair", flags.pipe);
  } catch (e) {
    const fresh = await running(home);
    if (fresh && !fresh.remote.listening) {
      ui.print(section("Pair"));
      printTailscaleHelp(fresh, ui);
      throw new Quiet();
    }
    throw e;
  }
  if (flags.json)
    return printJson({ url: pairing.url, expiresAt: pairing.expiresAt });
  const known = new Set(status.remote.devices.map((d) => d.id));
  const until = new Date(pairing.expiresAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  ui.print(section("Pair"));
  // All of it goes once a device is in, or the code runs out.
  const code = ui.mark();
  ui.print(indent(terminalQr(pairing.url, { color: colorful }), 3));
  ui.print(
    `\n   Scan it in the ${bold("Relay")} app on your phone, or paste the link in\n   ${bold("Settings → Computers")} on another computer:\n`,
  );
  ui.print(`   ${cyan(pairing.url)}\n`);
  if (!waitForDevice || !ui.live) {
    ui.print(dim(`   It works once, until ${until}.`));
    return;
  }
  const spin = ui.spin(
    `Waiting for a phone or computer ${dim(`· works once, until ${until} · Ctrl-C stops waiting`)}`,
  );
  for (;;) {
    await sleep(1000);
    if (Date.now() > pairing.expiresAt) {
      spin.stop();
      ui.take(code);
      ui.print(row("warn", "Expired", dim("the code ran out; relay pair makes a new one")));
      return;
    }
    const now = await running(home).catch(() => null);
    const added = now?.remote.devices.find((d) => !known.has(d.id));
    if (added) {
      spin.stop();
      ui.take(code);
      ui.print(
        row(
          "ok",
          added.name,
          dim(
            added.kind === "computer"
              ? "computer · can hand threads here now"
              : "phone · its threads, approvals and questions reach it now",
          ),
        ),
      );
      return;
    }
  }
}

function printTailscaleHelp(status: DaemonStatus, ui = new Screen()) {
  const { tailnet } = status.remote;
  const missing = tailnet.status === "missing";
  ui.print(
    row("warn", "Tailscale", "phones and computers reach Relay over it, and this computer isn't on it yet"),
  );
  const steps = [
    ...(missing
      ? [
          `Install Tailscale: ${process.platform === "linux" ? "curl -fsSL https://tailscale.com/install.sh | sh" : "https://tailscale.com/download"}`,
        ]
      : []),
    `Sign in to the same tailnet as your phone: ${bold("tailscale up")}`,
    `Run ${bold("relay pair")} again; Relay notices Tailscale within ten seconds.`,
  ];
  steps.forEach((step, i) => ui.print(`     ${dim(`${i + 1}.`)} ${step}`));
  if (status.remote.error) ui.print(dim(`     Relay said: ${status.remote.error}`));
}

/** An error already explained on the terminal. */
class Quiet extends Error {}

// ── Projects, threads, devices ─────────────────────────────────────────

async function projects(
  home: string,
  flags: Flags,
  [action, ...args]: string[],
) {
  const control = headlessPaths(home).control;
  if (action === "add") {
    if (!args.length) throw new Usage("relay projects add <folder>");
    await ensureRunning(home, flags);
    for (const folder of args) {
      const project = await callControl(control, "addProject", resolve(folder));
      if (flags.json) printJson(project);
      else console.log(ok(`Added ${bold(project.name)} ${dim(project.path)}`));
    }
    return;
  }
  if (action === "remove" || action === "rm") {
    const query = args.join(" ");
    if (!query) throw new Usage("relay projects remove <name>");
    await needRunning(home);
    const list = await callControl(control, "projects");
    const project = pick(list, query, (p) => [p.id, p.name, p.path], "project");
    await callControl(control, "removeProject", project.id);
    console.log(
      ok(
        `Removed ${bold(project.name)}; its folder and threads stay, and adding it again brings them back.`,
      ),
    );
    return;
  }
  if (action)
    throw new Usage(`Unknown: relay projects ${action}. Try add or remove.`);
  await needRunning(home);
  const list = await callControl(control, "projects");
  if (flags.json) return printJson(list);
  if (!list.length)
    return console.log(
      `No projects yet. Add one with ${bold("relay projects add <folder>")}.`,
    );
  console.log(
    table(list.map((p) => [bold(p.name), p.path, dim(p.id.slice(0, 8))])),
  );
}

async function threads(home: string, flags: Flags) {
  await needRunning(home);
  const rows = await callControl(headlessPaths(home).control, "threads");
  if (flags.json) return printJson(rows);
  const open = rows.filter((t) => t.state !== "settled");
  if (!open.length) return console.log("No open threads.");
  const width = Math.max(
    30,
    Math.min(60, (process.stdout.columns || 100) - 60),
  );
  console.log(
    table(
      open.map((t) => [
        stateMark(t),
        clip(t.title, width),
        dim(t.project),
        t.provider ? agentName(t.provider) : "",
        dim(ago(t.updated)),
      ]),
    ),
  );
  const settled = rows.length - open.length;
  if (settled)
    console.log(
      dim(`\n${settled} settled thread${settled === 1 ? "" : "s"} not shown.`),
    );
}

function stateMark(t: ThreadRow) {
  switch (t.state) {
    case "working":
      return cyan("● working");
    case "waiting":
      return yellow("◆ needs you");
    case "away":
      return dim(`→ on ${t.computer ?? "another computer"}`);
    default:
      return dim(t.computer ? `○ from ${t.computer}` : "○ idle");
  }
}

async function devices(
  home: string,
  flags: Flags,
  [action, ...args]: string[],
) {
  const status = await needRunning(home);
  const control = headlessPaths(home).control;
  const list = status.remote.devices;
  if (action === "remove" || action === "rm") {
    const query = args.join(" ");
    if (!query) throw new Usage("relay devices remove <name>");
    const device = pick(list, query, (d) => [d.id, d.name], "paired device");
    await callControl(control, "removeDevice", device.id);
    console.log(
      ok(`Unpaired ${bold(device.name)}; it can't connect any more.`),
    );
    return;
  }
  if (action) throw new Usage(`Unknown: relay devices ${action}. Try remove.`);
  if (flags.json) return printJson(list);
  if (!list.length)
    return console.log(
      `Nothing is paired yet. Pair a phone with ${bold("relay pair")}.`,
    );
  console.log(
    table(
      list.map((d) => [
        bold(d.name),
        d.kind ?? "phone",
        d.online
          ? green("online")
          : d.lastSeen
            ? dim(`seen ${ago(d.lastSeen)}`)
            : dim("never seen"),
        d.app ? dim(`app ${d.app.version}`) : "",
        dim(d.id.slice(0, 8)),
      ]),
    ),
  );
}

/** The one item `query` names by id, id prefix or name; anything else is an error listing the choices. */
function pick<T>(
  items: T[],
  query: string,
  keys: (item: T) => string[],
  what: string,
): T {
  const q = query.toLowerCase();
  const exact = items.filter((i) => keys(i).some((k) => k.toLowerCase() === q));
  if (exact.length === 1) return exact[0]!;
  const loose = items.filter((i) =>
    keys(i).some((k, n) =>
      n === 0 ? k.startsWith(q) : k.toLowerCase().includes(q),
    ),
  );
  if (loose.length === 1) return loose[0]!;
  const names = (loose.length ? loose : items)
    .map((i) => keys(i)[1])
    .join(", ");
  throw new Error(
    loose.length
      ? `More than one ${what} matches “${query}”: ${names}.`
      : `No ${what} matches “${query}”.${names ? ` There's ${names}.` : ""}`,
  );
}

async function needRunning(home: string) {
  const status = await running(home);
  if (!status)
    throw new Error("Relay isn't running. Start it with `relay start`.");
  return status;
}

// ── Service and setup ──────────────────────────────────────────────────

async function service(home: string, flags: Flags, [action]: string[]) {
  if (action === "install") {
    await stopForService(home);
    const { kind, file, note } = await installService({
      node: stableNode(),
      script,
      home,
      path: process.env.PATH ?? "",
    });
    console.log(ok(`Relay starts with the computer now (${kind}: ${file}).`));
    if (note) console.log(warn(note));
    return;
  }
  if (action === "uninstall") {
    const kind = await uninstallService();
    // launchd and systemd stop it as they let go; Windows has only the script.
    if (kind === "windows" && (await running(home))) {
      await callControl(headlessPaths(home).control, "stop", { detach: true });
      await stopped(home);
    }
    console.log(
      kind
        ? ok(
            `Relay no longer starts with the computer (${kind}). It isn't running now; relay start runs it until the next restart.`,
          )
        : "Relay wasn't set up as a service.",
    );
    return;
  }
  if (action && action !== "status")
    throw new Usage(
      `Unknown: relay service ${action}. Try install, uninstall or status.`,
    );
  const kind = installedService();
  if (flags.json)
    return printJson({
      service: kind,
      file: kind ? serviceFile(kind) : null,
      home: kind ? await serviceHome(kind) : null,
    });
  console.log(
    kind
      ? `Set up with ${kind} (${serviceFile(kind)}), for ${await serviceHome(kind)}.`
      : "Not set up as a service; relay service install does it.",
  );
}

async function uninstall(home: string, flags: Flags) {
  const purge =
    flags.purge &&
    (!process.stdin.isTTY ||
      flags.yes ||
      (await confirm(
        `Delete ${home} too: threads, their worktrees with any uncommitted work, paired devices and settings?`,
      )));
  if (await running(home)) {
    await callControl(headlessPaths(home).control, "stop", {
      force: flags.force,
    });
    await stopped(home);
    console.log(ok("Relay stopped."));
  }
  const kind = await uninstallService();
  if (kind)
    console.log(ok(`Relay no longer starts with the computer (${kind}).`));
  const root = installRoot(__dirname);
  if (root) {
    await removeCommand(root);
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
    console.log(ok(`Removed Relay from ${root}.`));
  } else
    console.log(
      dim("This Relay runs from a build, not an install; its files stay."),
    );
  if (purge) {
    await rm(home, { recursive: true, force: true, maxRetries: 5 });
    console.log(ok(`Deleted ${home}.`));
  } else
    console.log(
      `Threads, worktrees and settings stay in ${bold(home)}; delete it to remove them too.`,
    );
}

async function confirm(question: string) {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(`${question} ${dim("[y/N]")} `);
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    prompt.close();
  }
}

/**
 * Takes `relay` off PATH where the installer put it: the user's Path on
 * Windows, the link in ~/.local/bin elsewhere. The desktop app's own
 * `relay` there is a file, not a link into the install, so it stays.
 */
async function removeCommand(root: string) {
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$bin = $env:RELAY_UNINSTALL_BIN.TrimEnd('\\')
$path = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($path) { [Environment]::SetEnvironmentVariable('Path', (($path -split ';') | Where-Object { $_ -and $_.TrimEnd('\\') -ne $bin }) -join ';', 'User') }`,
      ],
      {
        env: { ...process.env, RELAY_UNINSTALL_BIN: join(root, "bin") },
        stdio: "ignore",
        windowsHide: true,
      },
    );
    return;
  }
  const real = await realpath(root);
  for (const dir of new Set([
    process.env.RELAY_BIN,
    join(homedir(), ".local", "bin"),
  ])) {
    if (!dir) continue;
    const link = join(dir, "relay");
    if (!(await lstat(link).catch(() => null))?.isSymbolicLink()) continue;
    const target = await realpath(link).catch(() => "");
    if (target.startsWith(real + sep)) await rm(link, { force: true });
  }
}

/**
 * In WSL, which stops the distribution 15 s after the last Windows program
 * using it exits, and Relay with it. A Windows Relay that works in this
 * distribution holds it awake; without one, `.wslconfig` can turn the timeout
 * off, for every distribution, which is why it's off unless asked for.
 */
async function setUpWsl(ui: Screen, distro: string) {
  if (
    !(await ui.ask(
      `Keep WSL running while Windows is on? Only needed when no Relay on Windows works in ${distro}: WSL stops it 15 seconds after its last window closes. This sets instanceIdleTimeout=-1 in .wslconfig, which keeps every WSL distribution running, and applies from WSL's next start.`,
      false,
    ))
  )
    return ui.print(
      row("off", "WSL", "stops 15 s after its last window closes, unless a Relay on Windows holds it"),
    );
  try {
    const file = await keepDistributionsUp();
    ui.print(
      row(
        "ok",
        "WSL",
        dim(file ? `stays running from WSL's next start (${file})` : "stays running"),
      ),
    );
  } catch (e) {
    ui.print(
      row(
        "warn",
        "WSL",
        `couldn't reach Windows (${e instanceof Error ? e.message : String(e)}); set instanceIdleTimeout=-1 under [general] in %USERPROFILE%\\.wslconfig yourself`,
      ),
    );
  }
}

async function setup(home: string, flags: Flags) {
  const ui = new Screen(process.stdout, process.stdin, !flags.yes);
  ui.print(
    `\n${bold(` Relay ${headlessVersion}`)}${" ".repeat(Math.max(2, 46 - headlessVersion.length))}${dim(tilde(home))}`,
  );

  ui.print(section("This computer"));
  ui.print(row("ok", "Node.js", dim(process.versions.node)));
  const git = gitVersion();
  ui.print(
    git
      ? row("ok", "Git", dim(git.replace(/^git version /, "")))
      : row("fail", "Git", "not installed; threads in worktrees and handoffs need it"),
  );
  let spin = ui.spin("Looking for Tailscale…");
  const tailnet = await tailnetProbe()(true);
  spin.stop();
  ui.print(
    tailnet.status === "connected"
      ? row(
          "ok",
          "Tailscale",
          dim([tailnet.name, ...tailnet.addresses].filter(Boolean).join(" · ")),
        )
      : row(
          "warn",
          "Tailscale",
          tailnet.status === "missing"
            ? "not installed; phones and computers reach Relay over it. Install it and sign in with tailscale up"
            : "off; run tailscale up and Relay picks it up within ten seconds",
        ),
  );
  await remember(home, flags);

  // Started with the computer, unless asked not to.
  const already = await running(home);
  if (
    flags.service &&
    (await ui.ask("Start Relay with this computer, in the background?", true))
  ) {
    spin = ui.spin("Setting up the background service…");
    await stopForService(home);
    const { kind, note } = await installService({
      node: stableNode(),
      script,
      home,
      path: process.env.PATH ?? "",
    });
    spin.stop();
    ui.print(row("ok", "Background", dim(`starts with the computer (${kind})`)));
    if (note) ui.print(row("warn", "", note));
  } else if (!already) {
    spin = ui.spin("Starting Relay…");
    await startDetached(home, script);
    spin.stop();
    ui.print(row("ok", "Background", dim("runs until this computer restarts")));
  } else
    ui.print(
      row("ok", "Background", dim("running; relay service install starts it with the computer")),
    );
  const distro = wslDistro();
  if (distro) await setUpWsl(ui, distro);
  // An installed release keeps itself current unless told not to.
  if (installRoot(__dirname)) {
    const autoUpdate = await ui.ask(
      "Install Relay's updates by themselves, once no thread is working?",
      (await readConfig(home)).autoUpdate ?? true,
    );
    await saveConfig(home, { autoUpdate });
    ui.print(
      autoUpdate
        ? row("ok", "Updates", dim("by themselves, once no thread is working"))
        : row("off", "Updates", "off; relay update installs one"),
    );
  }
  let status = await running(home);
  if (!status) {
    spin = ui.spin("Starting Relay…");
    status = await ensureRunning(home, flags, true);
    spin.stop();
  }

  ui.print(section("Agents"));
  const agents = (
    status.agents.length
      ? status.agents
      : ((await running(home))?.agents ?? [])
  ).filter((a) => a.provider !== "cursor");
  for (const agent of agents) {
    const name = agentName(agent.provider);
    if (!agent.path) continue;
    ui.print(
      agent.account && !agent.account.signedIn
        ? row("warn", name, `signed out; sign in once with ${bold(signIn(agent.provider))}`)
        : row("ok", name, dim(agent.current ?? "")),
    );
  }
  const missing = agents.filter((a) => !a.path).map((a) => agentName(a.provider));
  if (missing.length) ui.print(row("off", "Not found", missing.join(", ")));
  if (!agents.some((a) => a.path))
    ui.print(
      row(
        "warn",
        "No agent",
        "install Claude Code, Codex or OpenCode and sign in once, as the user Relay runs as",
      ),
    );

  ui.print(section("Projects"));
  const control = headlessPaths(home).control;
  for (const folder of flags.projects)
    await callControl(control, "addProject", resolve(folder));
  let list = await callControl(control, "projects");
  const here = process.cwd();
  if (
    !flags.projects.length &&
    !list.some((p) => p.path === here) &&
    existsSync(join(here, ".git")) &&
    (await ui.ask(`Add ${bold(tilde(here))} as a project?`, false))
  ) {
    await callControl(control, "addProject", here);
    list = await callControl(control, "projects");
  }
  for (const p of list) ui.print(row("ok", p.name, dim(tilde(p.path))));
  if (!list.length)
    ui.print(
      row(
        "off",
        "None yet",
        "relay projects add <folder>; a thread handed over needs its repository cloned here",
      ),
    );

  const fresh = (await running(home))!;
  if (fresh.remote.devices.length) {
    ui.print(section("Paired"));
    for (const d of fresh.remote.devices) ui.print(deviceRow(d));
  } else if (!fresh.remote.listening) {
    ui.print(section("Pair"));
    printTailscaleHelp(fresh, ui);
  } else if (flags.pair && ui.live) await pair(home, flags, true, ui);
  else {
    ui.print(section("Pair"));
    ui.print(row("off", "Not yet", "relay pair shows a code for a phone or computer"));
  }
  ui.print(
    `\n ${green("Done.")} ${bold("relay status")} ${dim("shows how it's doing,")} ${bold("relay pair")} ${dim("adds a device")}\n       ${dim("and")} ${bold("relay settings")} ${dim("sets up dictation, read aloud, Cursor and Gitea.")}`,
  );
}

/** A path under the home folder as ~/…, as people type it. */
function tilde(path: string) {
  const home = homedir();
  return path === home || path.startsWith(home + sep)
    ? `~${path.slice(home.length)}`
    : path;
}

function deviceRow(d: DaemonStatus["remote"]["devices"][number]) {
  const seen = d.online
    ? green("online")
    : d.lastSeen
      ? `seen ${ago(d.lastSeen)}`
      : "never seen";
  return row(d.online ? "ok" : "off", d.name, dim(`${d.kind ?? "phone"} · `) + seen);
}

function signIn(provider: AgentProvider) {
  const info = agentInfo(provider);
  return "login" in info ? `${provider} ${info.login}` : provider;
}

async function update(home: string, flags: Flags) {
  const root = installRoot(__dirname);
  if (!root)
    throw new Error(
      `This Relay runs from a build in ${resolve(__dirname, "..")}; update it with git pull and npm run build:headless.`,
    );
  // A running daemon owns its update and restart. Standalone installs use
  // the same installation lock as the daemon (including other Relay homes).
  const daemon = await running(home);
  const updater = daemon
    ? undefined
    : new HeadlessUpdater(root, headlessVersion);
  const result = daemon
    ? await callControl(headlessPaths(home).control, "update", flags.check)
    : flags.check
      ? await updater!.check()
      : await updater!.install();
  if (result.status === "error") throw new Error(result.message);
  if (flags.json) return printJson(result);
  if (result.status === "available" || result.status === "ready") {
    console.log(
      `Relay ${bold(result.version)} is out; ${bold("relay update")} installs it.`,
    );
  } else if (result.status === "installing") {
    console.log(
      ok(
        `Relay ${result.version} is installed in ${root}.${daemon ? " Restarting Relay; agents carry on." : ""}`,
      ),
    );
  } else if (result.status === "idle") {
    console.log(ok(`Relay ${result.current} is the newest.`));
  } else {
    throw new Error(
      `Relay update did not finish (${result.status}); try again.`,
    );
  }
}

function gitVersion() {
  try {
    return execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

async function call(home: string, [method, ...args]: string[]) {
  if (!method) throw new Usage("relay call <method> [json arguments…]");
  await needRunning(home);
  const parsed = args.map((a) => {
    try {
      return JSON.parse(a) as unknown;
    } catch {
      return a;
    }
  });
  printJson(
    await callControl(headlessPaths(home).control, "call", method, parsed),
  );
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

main(process.argv.slice(2)).catch((e) => {
  if (!(e instanceof Quiet))
    console.error(
      e instanceof Usage
        ? `${e.message}`
        : fail(e instanceof Error ? e.message : String(e)),
    );
  process.exit(
    e instanceof Usage
      ? 2
      : e instanceof AlreadyRunning
        ? alreadyRunningCode
        : 1,
  );
});
