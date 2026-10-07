import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { stripVTControlCharacters } from "node:util";
import type { DevServerState } from "../../shared/preview";
import { terminate } from "../platform/terminate";
import { inheritedEnv, userShell } from "../terminal/env";

const keepChars = 16 * 1024;
const START_TIMEOUT_MS = 3 * 60_000;
export const IDLE_MS = 30 * 60_000;

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

interface Server {
  folder: string;
  port: number;
  child?: ChildProcess;
  state: DevServerState;
  /** Previews showing it now; it sleeps only with none. */
  watchers: number;
  usedAt: number;
}

/**
 * The projects' dev servers, one per folder, started when a preview needs
 * one and stopped after half an hour nobody looked.
 */
export class DevServers {
  private servers = new Map<string, Server>();
  private sweep: NodeJS.Timeout;

  constructor(
    private changed: (folder: string, state: DevServerState) => void,
    private now = Date.now,
  ) {
    this.sweep = setInterval(() => this.sleepIdle(), 60_000);
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
    const had = this.servers.get(folder);
    if (had?.port === port && had.state.state === "starting")
      return this.waitFor(had);
    if (had?.port === port && had.state.state === "running" && had.child)
      return had.state;
    if (had && had.port !== port) this.stop(folder);
    const server: Server = had?.port === port
      ? had
      : { folder, port, watchers: 0, usedAt: this.now(), state: { state: "starting", port } };
    this.servers.set(folder, server);
    server.usedAt = this.now();
    if (await listening(port)) {
      this.set(server, { state: "running", port, ours: false });
      return server.state;
    }
    this.set(server, { state: "starting", port });
    let output = "";
    const [shell] = userShell();
    const childEnv = { ...inheritedEnv(), ...env, PORT: String(port) };
    const child =
      process.platform === "win32"
        ? spawn(command, { cwd: folder, env: childEnv, shell: true, windowsHide: true })
        : spawn(shell, ["-lc", command], {
            cwd: folder,
            env: childEnv,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
    server.child = child;
    const add = (chunk: Buffer | string) => {
      output = (output + stripVTControlCharacters(String(chunk))).slice(-keepChars);
    };
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    const failed = (why?: string) => {
      if (server.child !== child) return;
      server.child = undefined;
      if (server.state.state === "asleep") return;
      this.set(server, { state: "failed", port, output: why ? `${output}${why}\n` : output });
    };
    child.on("error", (e) => failed(e.message));
    child.on("exit", (code, signal) =>
      failed(server.state.state === "running" || code === null
        ? `Exited${signal ? ` on ${signal}` : ""}.`
        : `Exited with code ${code}.`),
    );
    const started = this.now();
    void (async () => {
      while (server.child === child && server.state.state === "starting") {
        if (await listening(port)) {
          if (server.child === child)
            this.set(server, { state: "running", port, ours: true });
          return;
        }
        if (this.now() - started > START_TIMEOUT_MS) {
          terminate(child, { group: true });
          failed(`Nothing listened on port ${port} after ${START_TIMEOUT_MS / 60_000} minutes.`);
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    })();
    return this.waitFor(server);
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

  /** Puts the servers nobody watched for half an hour to sleep. */
  sleepIdle() {
    for (const server of this.servers.values())
      if (
        server.child &&
        !server.watchers &&
        this.now() - server.usedAt > IDLE_MS
      ) {
        const child = server.child;
        this.set(server, { state: "asleep", port: server.port });
        server.child = undefined;
        terminate(child, { group: true });
      }
  }

  stop(folder: string) {
    const server = this.servers.get(folder);
    if (!server) return;
    this.servers.delete(folder);
    if (server.child) terminate(server.child, { group: true });
  }

  dispose() {
    clearInterval(this.sweep);
    for (const folder of [...this.servers.keys()]) this.stop(folder);
  }

  private set(server: Server, state: DevServerState) {
    server.state = state;
    this.changed(server.folder, state);
  }
}
