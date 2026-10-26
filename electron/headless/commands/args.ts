import { agentInfo, type AgentProvider } from "../../../shared/agents";
import { bold } from "../format";

// The command line: flags, and the help that lists them.

export const agentName = (provider: string) =>
  agentInfo(provider as AgentProvider)?.cli ?? provider;

export interface Flags {
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

export class Usage extends Error {}

export function parse(argv: string[]) {
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

export const help = `${bold("relay")} — your agents on this computer, reached from your phone and your other computers.

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
  --port <number>  The port phones and computers connect to (default 47821; 47822 in mirrored WSL)
  --name <name>    What phones and other computers call this one (default: its host name)
  --json           Print machine-readable output
`;
