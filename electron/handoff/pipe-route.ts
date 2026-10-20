// A computer reached through a command's stdin and stdout instead of the
// network: `ssh <host>` with this computer's own SSH (keys, ssh-agent,
// ~/.ssh/config, jump hosts), or wsl.exe into a WSL distribution. The command
// runs `relay pipe` there, which carries the same encrypted bridge to that
// Relay's loopback. A listener on this computer's loopback hands each
// connection the bridge client makes to a pipe of its own, so the client
// runs as it does over the network.
import { execFile, spawn } from "node:child_process";
import { createServer, type AddressInfo, type Server } from "node:net";
import { promisify } from "node:util";
import {
  pipeReady,
  type ComputerRoute,
  type RouteCheck,
} from "../../shared/handoff";

const run = promisify(execFile);

/**
 * Sets `r` to the `relay` there: where the installer linked it (`RELAY_BIN`
 * moves that), as a login shell's PATH may not have it, else on the PATH;
 * empty when there's none.
 */
const findRelay = [
  'r="${RELAY_BIN:+$RELAY_BIN/relay}"',
  '[ -x "$r" ] || r="$HOME/.local/bin/relay"',
  '[ -x "$r" ] || r=$(command -v relay) || r=',
].join("; ");

/**
 * One word for whichever login shell ssh hands it to, fish and csh included:
 * single quotes there keep everything but quotes and, in fish, backslashes,
 * so those two go outside them.
 */
const quoted = (line: string) =>
  `'${line.replace(/['\\]/g, (c) => `'\\${c}'`)}'`;

/** The command that runs the shell line `line` under sh on the computer the route reaches. */
export function routeShell(
  route: ComputerRoute,
  line: string,
): [string, string[]] {
  if (route.kind === "ssh")
    return [
      "ssh",
      // No terminal, and no password prompt nobody would see: keys or the agent.
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ServerAliveInterval=15",
        route.host,
        `sh -c ${quoted(line)}`,
      ],
    ];
  return ["wsl.exe", ["-d", route.distro, "--exec", "sh", "-c", line]];
}

/** wsl.exe's own errors (no such distribution, the service down) in UTF-8, not UTF-16. */
export const routeEnv = () => ({ ...process.env, WSL_UTF8: "1" });

/** What a command printed, without the NULs a UTF-16 wsl.exe message leaves. */
const text = (out: string) => out.replace(/\0/g, "");

/** The command that runs `relay <args>` on the computer the route reaches. */
export const routeCommand = (
  route: ComputerRoute,
  args: string[],
): [string, string[]] =>
  routeShell(route, `${findRelay}; exec "\${r:-relay}" ${args.join(" ")}`);

/** How the route reads in words: `ssh box`, `WSL Ubuntu`. */
export const routeName = (route: ComputerRoute) =>
  route.kind === "ssh" ? `ssh ${route.host}` : `WSL ${route.distro}`;

const lastLine = (out: string) =>
  text(out).trim().split(/\r?\n/).filter(Boolean).at(-1)?.trim();

/**
 * wsl.exe's own error, which it prints on stdout: its first line says it in
 * words, above an `Error code: Wsl/…` line.
 */
function wslError(stdout: string) {
  const lines = text(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim());
  const at = lines.findIndex((line) => /^Error code: Wsl\//.test(line));
  if (at === -1) return undefined;
  return lines.slice(0, at).filter(Boolean)[0] ?? lines[at];
}

/** What went wrong in words, from what the command printed. */
function failure(
  route: ComputerRoute,
  said: string,
  code: number | null,
  stdout = "",
) {
  const wsl = route.kind === "wsl" && wslError(stdout);
  if (route.kind === "wsl" && wsl)
    return `WSL couldn't start ${route.distro}: ${wsl}`;
  const stderr = text(said);
  if (/relay: (not found|No such file)|No such file or directory/.test(stderr))
    return `Relay isn't installed ${route.kind === "ssh" ? `on ${route.host}` : `in ${route.distro}`}. Install it there with curl -fsSL https://relaycode.io/install.sh | sh, then try again.`;
  // A Relay from before `relay pipe`.
  if (/Unknown command .pipe.|Unknown option --pipe/.test(stderr))
    return `The Relay ${route.kind === "ssh" ? `on ${route.host}` : `in ${route.distro}`} is too old to connect this way. Update it there with relay update, then try again.`;
  if (route.kind === "ssh") {
    // Nobody sees ssh's prompts here, so what it would have asked fails instead.
    if (/Host key verification failed/.test(stderr))
      return `This computer doesn't know ${route.host}'s host key yet. Run ssh ${route.host} once in a terminal to accept it, then try again.`;
    if (/REMOTE HOST IDENTIFICATION HAS CHANGED/.test(stderr))
      return `${route.host}'s host key changed since this computer last saw it. Check why, and update ~/.ssh/known_hosts if it's expected.`;
    if (/Permission denied/.test(stderr))
      return `${route.host} didn't take this computer's SSH keys. Relay can't type a password: add a key there (ssh-copy-id ${route.host}) or to your ssh-agent, then try again.`;
  }
  return lastLine(stderr) ?? `${routeName(route)} ended (${code ?? "killed"}).`;
}

/** The command itself isn't there: no ssh client, or no WSL. */
const missing = (route: ComputerRoute) =>
  route.kind === "ssh"
    ? "There's no ssh on this computer. Install OpenSSH, then try again."
    : "WSL isn't installed on this computer.";

export class PipeShim {
  private server?: Server;
  /** Why the last pipe ended, while none has worked since. */
  failure?: string;
  constructor(
    private route: ComputerRoute,
    private command = routeCommand,
  ) {}
  /** Starts listening on a free loopback port and returns it. */
  async listen() {
    const server = createServer((socket) => {
      const [file, args] = this.command(this.route, ["pipe"]);
      const child = spawn(file, args, {
        env: routeEnv(),
        stdio: "pipe",
        windowsHide: true,
      });
      let stderr = "";
      // Its start only: wsl.exe says why it couldn't start the distribution there.
      let started = "";
      let spawned = true;
      child.stderr.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-4000);
      });
      child.stdout.on("data", (d: Buffer) => {
        if (started.length < 4000) started += d.toString();
      });
      // What a login shell's startup files print comes first; the bridge
      // starts past `pipeReady`.
      const ready = Buffer.from(pipeReady);
      let ahead = Buffer.alloc(0);
      const skip = (d: Buffer) => {
        ahead = Buffer.concat([ahead, d]);
        const at = ahead.indexOf(ready);
        if (at === -1) {
          ahead = ahead.subarray(-(ready.length - 1));
          return;
        }
        child.stdout.off("data", skip);
        this.failure = undefined;
        socket.write(ahead.subarray(at + ready.length));
        child.stdout.pipe(socket);
      };
      child.stdout.on("data", skip);
      socket.pipe(child.stdin);
      // Either end going away takes the other with it.
      child.stdin.on("error", () => {});
      socket.on("error", () => child.kill());
      socket.on("close", () => child.kill());
      child.on("error", (e: NodeJS.ErrnoException) => {
        spawned = false;
        this.failure = e.code === "ENOENT" ? missing(this.route) : e.message;
        socket.destroy();
      });
      // On close, not exit: what it printed last, its error included, is through by then.
      child.on("close", (code) => {
        if (code && spawned)
          this.failure = failure(this.route, stderr, code, started);
        socket.destroy();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.server = server;
    return (server.address() as AddressInfo).port;
  }
  close() {
    this.server?.close();
  }
}

/** A pairing link from the Relay the route reaches, starting it if needed. */
export async function pairingLink(
  route: ComputerRoute,
  command = routeCommand,
  signal?: AbortSignal,
) {
  const [file, args] = command(route, ["pair", "--json", "--pipe"]);
  try {
    const { stdout } = await run(file, args, {
      env: routeEnv(),
      timeout: 90_000,
      windowsHide: true,
      signal,
    });
    const url = (lastJson(text(stdout)) as { url?: unknown } | undefined)?.url;
    if (typeof url !== "string")
      throw new Error(`Relay over ${routeName(route)} gave no pairing code.`);
    return url;
  } catch (e) {
    if (signal?.aborted) throw new Error("Stopped.");
    const { stdout, stderr, code } = e as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    if (code === "ENOENT") throw new Error(missing(route));
    if (stderr !== undefined && typeof code !== "string")
      throw new Error(failure(route, stderr, code ?? null, stdout));
    throw e;
  }
}

/** The JSON a command printed last, past whatever a shell startup file printed before it. */
function lastJson(out: string): unknown {
  for (const { index } of [...out.matchAll(/^\{/gm)].reverse())
    try {
      return JSON.parse(out.slice(index));
    } catch {
      // Not where it starts; an earlier line may be.
    }
  return undefined;
}

// The line itself says what it found, so a failing exit is always the route's.
const versionLine = [
  findRelay,
  'if [ -z "$r" ]; then echo relay-missing; exit 0; fi',
  'if out=$("$r" --version 2>&1); then echo "relay $out"',
  'else echo "relay-broken $(printf "%s\\n" "$out" | tail -n 1)"; fi',
].join("; ");

/**
 * Reaches the computer the route goes to and asks its Relay for its version,
 * so a checkup can say what's missing before pairing tries.
 */
export async function checkRoute(
  route: ComputerRoute,
  shell = routeShell,
  signal?: AbortSignal,
): Promise<RouteCheck> {
  const [file, args] = shell(route, versionLine);
  const started = Date.now();
  try {
    const { stdout } = await run(file, args, {
      env: routeEnv(),
      timeout: 30_000,
      windowsHide: true,
      signal,
    });
    const ms = Date.now() - started;
    // A shell startup file may print before it; the answer is the last line.
    const said = lastLine(stdout) ?? "";
    if (said === "relay-missing") return { ms, relay: null };
    const broken = /^relay-broken ?(.*)$/.exec(said);
    if (broken)
      return { ms, relay: "", broken: broken[1] || "It doesn't start." };
    return { ms, relay: said.replace(/^relay v?/, "") };
  } catch (e) {
    if (signal?.aborted) throw new Error("Stopped.");
    const { stdout, stderr, code, killed } = e as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    if (code === "ENOENT") throw new Error(missing(route));
    if (killed)
      throw new Error(`${routeName(route)} didn't answer within 30s.`);
    throw new Error(
      failure(
        route,
        stderr ?? "",
        typeof code === "number" ? code : null,
        stdout,
      ),
    );
  }
}

/** The WSL distributions on this computer, by name; none off Windows or without WSL. */
export const wslDistros = () => listDistros([]);

/** The WSL distributions running now, which asking doesn't start. */
export const runningWslDistros = async () =>
  new Set(await listDistros(["--running"]));

async function listDistros(only: string[]): Promise<string[]> {
  if (process.platform !== "win32") return [];
  try {
    // wsl.exe answers in UTF-16 unless told otherwise; with none running it fails.
    const { stdout } = await run("wsl.exe", ["--list", ...only, "--quiet"], {
      env: routeEnv(),
      timeout: 15_000,
      windowsHide: true,
    });
    return text(stdout)
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter((name) => /^[A-Za-z0-9_.-]{1,64}$/.test(name));
  } catch {
    return [];
  }
}
