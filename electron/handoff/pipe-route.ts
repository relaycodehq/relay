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
import type { ComputerRoute } from "../../shared/handoff";

const run = promisify(execFile);

/** Where the installer links `relay`; a login shell's PATH may not have it. */
const remoteRelay = '"$HOME/.local/bin/relay"';

/** The command that runs `relay <args>` on the computer the route reaches. */
export function routeCommand(
  route: ComputerRoute,
  args: string[],
): [string, string[]] {
  const command = `exec ${remoteRelay} ${args.join(" ")}`;
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
        command,
      ],
    ];
  return ["wsl.exe", ["-d", route.distro, "--exec", "sh", "-c", command]];
}

/** How the route reads in words: `ssh box`, `WSL Ubuntu`. */
export const routeName = (route: ComputerRoute) =>
  route.kind === "ssh" ? `ssh ${route.host}` : `WSL ${route.distro}`;

const lastLine = (text: string) =>
  text.trim().split(/\r?\n/).filter(Boolean).at(-1)?.trim();

/** What went wrong in words, from what the command printed. */
function failure(route: ComputerRoute, stderr: string, code: number | null) {
  if (/relay: (not found|No such file)|No such file or directory/.test(stderr))
    return `Relay isn't installed ${route.kind === "ssh" ? `on ${route.host}` : `in ${route.distro}`}. Install it there with curl -fsSL https://relaycode.io/install.sh | sh, then try again.`;
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
      const child = spawn(file, args, { stdio: "pipe", windowsHide: true });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-4000);
      });
      child.stdout.once("data", () => (this.failure = undefined));
      socket.pipe(child.stdin);
      child.stdout.pipe(socket);
      // Either end going away takes the other with it.
      child.stdin.on("error", () => {});
      socket.on("error", () => child.kill());
      socket.on("close", () => child.kill());
      child.on("error", (e: NodeJS.ErrnoException) => {
        this.failure = e.code === "ENOENT" ? missing(this.route) : e.message;
        socket.destroy();
      });
      child.on("exit", (code) => {
        if (code) this.failure = failure(this.route, stderr, code);
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
) {
  const [file, args] = command(route, ["pair", "--json", "--pipe"]);
  try {
    const { stdout } = await run(file, args, {
      timeout: 90_000,
      windowsHide: true,
    });
    const url = (JSON.parse(stdout) as { url?: string }).url;
    if (!url)
      throw new Error(`Relay over ${routeName(route)} gave no pairing code.`);
    return url;
  } catch (e) {
    const { stderr, code } = e as { stderr?: string; code?: number | string };
    if (code === "ENOENT") throw new Error(missing(route));
    if (stderr !== undefined && typeof code !== "string")
      throw new Error(failure(route, stderr, code ?? null));
    throw e;
  }
}

/** The WSL distributions on this computer, by name; none off Windows or without WSL. */
export async function wslDistros(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  try {
    // wsl.exe answers in UTF-16 unless told otherwise.
    const { stdout } = await run("wsl.exe", ["--list", "--quiet"], {
      env: { ...process.env, WSL_UTF8: "1" },
      timeout: 15_000,
      windowsHide: true,
    });
    return stdout
      .replace(/\0/g, "")
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter((name) => /^[A-Za-z0-9_.-]{1,64}$/.test(name));
  } catch {
    return [];
  }
}
