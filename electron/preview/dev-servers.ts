import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import type { DevServerState } from "../../shared/preview";
import { HostedChild } from "../agent-host/child";
import type { Entry } from "../agent-host/protocol";
import { foundSessions, inAgentHost, savedMeta } from "../agents";
import { terminate } from "../platform/terminate";
import { inheritedEnv, userShell } from "../terminal/env";
import { projectTasks } from "../terminal/tasks";
import { connectedPorts } from "./connected-ports";

const keepChars = 16 * 1024;
const START_TIMEOUT_MS = 3 * 60_000;
export const IDLE_MS = 30 * 60_000;
/** Sweeps in a row that couldn't tell who's connected before only previews count. */
const PROBE_GIVE_UP = 3;

/** Whether something accepts connections on the port, over IPv4 or IPv6. */
export function listening(port: number, timeoutMs = 400): Promise<boolean> {
  const one = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ host, port });
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  return Promise.all([one("127.0.0.1"), one("::1")]).then(([a, b]) => a || b);
}

/** What the agent host keeps with a server it runs, for the next Relay. */
const savedServer = z.object({
  provider: z.literal("dev-server"),
  folder: z.string(),
  port: z.number().int(),
  command: z.string(),
});

/** The output a server taken back after a restart printed last, as much as is kept. */
function lastLines(entries: Entry[]) {
  const lines: string[] = [];
  let chars = 0;
  for (let i = entries.length - 1; i >= 0 && chars < keepChars; i--) {
    const entry = entries[i]!;
    if (entry.kind !== "line") continue;
    lines.push(entry.text);
    chars += entry.text.length + 1;
  }
  return lines.reverse();
}

interface Server {
  folder: string;
  port: number;
  /** In the agent host when there is one, so it outlives a restart of Relay. */
  child?: ChildProcess | HostedChild;
  state: DevServerState;
  /** Previews showing it now; it sleeps only with none. */
  watchers: number;
  usedAt: number;
}

/**
 * The projects' dev servers, one per folder, started when a preview needs
 * one and stopped after half an hour nobody looked or connected. Those the
 * agent host runs keep running while Relay restarts.
 */
export class DevServers {
  private servers = new Map<string, Server>();
  private sweep: NodeJS.Timeout;
  private reattached?: Promise<void>;
  private reattaching = false;
  private probeFailures = 0;
  private gaveUpProbing = false;

  constructor(
    private changed: (folder: string, state: DevServerState) => void,
    private now = Date.now,
    private connected = connectedPorts,
  ) {
    this.sweep = setInterval(() => void this.sleepIdle(), 60_000);
    this.sweep.unref();
  }

  state(folder: string): DevServerState | undefined {
    return this.servers.get(folder)?.state;
  }

  /**
   * Starts `command` in `folder` unless something listens on `port` already;
   * resolves once the port answers or the command gives up.
   */
  async ensure(
    folder: string,
    command: string,
    port: number,
    env: Record<string, string>,
  ): Promise<DevServerState> {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("The preview’s dev port must be between 1 and 65535.");
    // A server the host kept through a restart is this folder's already.
    if (this.reattaching) await this.reattached;
    const had = this.servers.get(folder);
    if (had) had.usedAt = this.now();
    if (had?.port === port && had.state.state === "starting")
      return this.waitFor(had);
    if (had?.port === port && had.state.state === "running" && had.child)
      return had.state;
    if (had && had.port !== port) this.stop(folder);
    const server: Server =
      had?.port === port
        ? had
        : {
            folder,
            port,
            watchers: 0,
            usedAt: this.now(),
            state: { state: "starting", port },
          };
    this.servers.set(folder, server);
    server.usedAt = this.now();
    // Claim the restart before probing, so concurrent wakeups share this start.
    this.set(server, { state: "starting", port });
    const up = await listening(port);
    if (this.servers.get(folder) !== server) return server.state;
    if (up) {
      this.set(server, { state: "running", port, ours: false });
      return server.state;
    }
    const child = await this.launch(folder, command, port, env);
    if (
      this.servers.get(folder) !== server ||
      server.state.state !== "starting"
    ) {
      terminate(child, { group: true });
      return server.state;
    }
    this.follow(server, child, command);
    return this.waitFor(server);
  }

  /** Runs the command in the agent host, or in Relay without one. */
  private async launch(
    folder: string,
    command: string,
    port: number,
    env: Record<string, string>,
  ): Promise<ChildProcess | HostedChild> {
    const childEnv = { ...inheritedEnv(), ...env, PORT: String(port) };
    if (process.platform === "win32")
      return spawn(command, {
        cwd: folder,
        env: childEnv,
        shell: true,
        windowsHide: true,
      });
    const [shell] = userShell();
    const hosted = await inAgentHost("the dev server", (hosts) =>
      hosts.openProcess({
        key: `dev-server:${folder}`,
        meta: {
          provider: "dev-server",
          folder,
          port,
          command,
        } satisfies z.infer<typeof savedServer>,
        process: {
          command: shell,
          args: ["-lc", command],
          cwd: folder,
          env: childEnv,
          group: true,
          logErrors: true,
        },
      }),
    );
    if (hosted) return new HostedChild(hosted);
    return spawn(shell, ["-lc", command], {
      cwd: folder,
      env: childEnv,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  /** Keeps the server's output and state, until it listens or gives up. */
  private follow(
    server: Server,
    child: ChildProcess | HostedChild,
    command: string,
  ) {
    const { folder, port } = server;
    server.child = child;
    const hosted = child instanceof HostedChild ? child : undefined;
    if (child instanceof HostedChild)
      void child.hosted.pid().then((pid) => {
        if (pid && server.child === child)
          projectTasks.trackServer(pid, command, folder);
      });
    else if (child.pid) projectTasks.trackServer(child.pid, command, folder);
    let output = "";
    const add = (chunk: Buffer | string) => {
      output = (output + stripVTControlCharacters(String(chunk))).slice(
        -keepChars,
      );
    };
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    const failed = (why?: string) => {
      if (server.child !== child) return;
      server.child = undefined;
      if (server.state.state === "asleep") return;
      this.set(server, {
        state: "failed",
        port,
        output: why ? `${output}${why}\n` : output,
      });
    };
    child.on("error", (e) => failed(e.message));
    child.on("exit", (code, signal) => {
      if (hosted) {
        // The host said how it exited; the session has nothing left to keep.
        hosted.hosted.close();
        return failed();
      }
      failed(
        server.state.state === "running" || code === null
          ? `Exited${signal ? ` on ${signal}` : ""}.`
          : `Exited with code ${code}.`,
      );
    });
    hosted?.release();
    const started = this.now();
    void (async () => {
      while (server.child === child && server.state.state === "starting") {
        const up = await listening(port);
        if (server.child !== child) return;
        if (up) {
          this.set(server, { state: "running", port, ours: true });
          return;
        }
        if (this.now() - started > START_TIMEOUT_MS) {
          // Before terminating: a hosted child exits at once, and its exit
          // would fail the server without saying why.
          failed(
            `Nothing listened on port ${port} after ${START_TIMEOUT_MS / 60_000} minutes.`,
          );
          terminate(child, { group: true });
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    })();
  }

  /**
   * Takes back the servers the agent host kept running while Relay
   * restarted. One that exited meanwhile, or that this Relay can't read,
   * ends; the next preview starts it again.
   */
  reattach(): Promise<void> {
    if (this.reattached) return this.reattached;
    this.reattaching = true;
    this.reattached = (async () => {
      for (const found of await foundSessions("dev-server", "process")) {
        const saved = found.info.ended
          ? undefined
          : savedMeta(found, savedServer);
        if (!saved || this.servers.has(saved.folder)) {
          found.close();
          continue;
        }
        const server: Server = {
          folder: saved.folder,
          port: saved.port,
          watchers: 0,
          usedAt: this.now(),
          state: { state: "starting", port: saved.port },
        };
        this.servers.set(saved.folder, server);
        this.set(server, server.state);
        this.follow(
          server,
          new HostedChild(found.attachProcess(), lastLines),
          saved.command,
        );
      }
    })()
      .catch((error) =>
        console.warn("Couldn't take back the dev servers:", error),
      )
      .finally(() => (this.reattaching = false));
    return this.reattached;
  }

  private waitFor(server: Server) {
    return new Promise<DevServerState>((resolve) => {
      const check = () => {
        if (server.state.state !== "starting") resolve(server.state);
        else setTimeout(check, 200);
      };
      check();
    });
  }

  /** A preview of the folder shows, or stops showing. */
  watch(folder: string, on: boolean) {
    const server = this.servers.get(folder);
    if (!server) return;
    server.watchers = Math.max(0, server.watchers + (on ? 1 : -1));
    server.usedAt = this.now();
  }

  /**
   * Puts the servers nobody watched or connected to for half an hour to
   * sleep. A browser outside Relay shows up only as a connection.
   */
  async sleepIdle() {
    const unwatched = [...this.servers.values()].filter(
      (server) => server.child && !server.watchers,
    );
    if (!unwatched.length) return;
    const busy = await this.connected(unwatched.map((s) => s.port)).then(
      (found) => {
        this.probeFailures = 0;
        return found;
      },
      (error) => this.unknownConnections(error),
    );
    if (!busy) return;
    for (const server of unwatched) {
      if (busy.has(server.port)) server.usedAt = this.now();
      const child = server.child;
      if (
        child &&
        !server.watchers &&
        this.servers.get(server.folder) === server &&
        this.now() - server.usedAt > IDLE_MS
      ) {
        this.set(server, { state: "asleep", port: server.port });
        server.child = undefined;
        terminate(child, { group: true });
      }
    }
  }

  /**
   * Without an answer a server in use looks idle, so a look that failed keeps
   * every server awake. One that can't run here at all, or keeps failing,
   * would keep them awake for good: then only previews count.
   */
  private unknownConnections(error: unknown): Set<number> | undefined {
    const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
    if (!missing && ++this.probeFailures < PROBE_GIVE_UP) return undefined;
    if (!this.gaveUpProbing)
      console.warn(
        "Can't tell who's connected to the dev servers, so only open previews keep them awake:",
        error,
      );
    this.gaveUpProbing = true;
    return new Set();
  }

  stop(folder: string) {
    const server = this.servers.get(folder);
    if (!server) return;
    this.servers.delete(folder);
    // Settle waiters and invalidate the child before its final events arrive.
    server.state = { state: "asleep", port: server.port };
    const child = server.child;
    server.child = undefined;
    if (child) terminate(child, { group: true });
  }

  /** Relay is restarting: what the host runs carries on, the rest ends with Relay. */
  detach() {
    clearInterval(this.sweep);
    for (const [folder, server] of [...this.servers]) {
      if (server.child instanceof HostedChild) {
        this.servers.delete(folder);
        server.child = undefined;
      } else this.stop(folder);
    }
  }

  /** Relay is quitting: every server it started stops. */
  dispose() {
    clearInterval(this.sweep);
    for (const folder of [...this.servers.keys()]) this.stop(folder);
  }

  private set(server: Server, state: DevServerState) {
    server.state = state;
    this.changed(server.folder, state);
  }
}
