// Relay's side of the agent host: finds the hosts left running, starts one
// when none of the current version is, and hands each Claude session a
// stand-in for the SDK's query, and each hosted process a line channel.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  closingFailure,
  protocolVersion,
  readLines,
  writeLine,
  type ClientMessage,
  type HookMode,
  type HostMessage,
  type HostRecord,
  type ProcessSpec,
  type SessionInfo,
} from "./protocol";
import { toolText, type ToolResult } from "../relay-mcp/tools";
import { errorMessage } from "../../shared/error-message";
import { pidAlive as alive } from "../util/pid";
import { HostedProcess } from "./hosted-process";
import { HostedQuery, type HostedHandlers } from "./hosted-query";
import { ToolHandlerSlot } from "./tool-handler-slot";

export { HostedProcess, type ProcessReader } from "./hosted-process";
export { HostedQuery, type HostedHandlers } from "./hosted-query";

export interface HostedOpen {
  key: string;
  meta: unknown;
  /** The SDK's options, minus its callbacks. */
  options: Record<string, unknown>;
  hooks: Record<string, HookMode>;
  handlers: HostedHandlers;
}

export interface HostedProcessOpen {
  key: string;
  meta: unknown;
  process: ProcessSpec;
}

/** Answers a call an agent made to Relay's tools; see electron/relay-mcp. */
export type ToolHandler = (
  chatId: string,
  name: string,
  args: unknown,
  signal: AbortSignal,
) => Promise<ToolResult>;

export class AgentHosts {
  private toolSlot = new ToolHandlerSlot();
  private connections: HostConnection[] = [];
  private starting?: Promise<HostConnection>;
  private discovered?: Promise<FoundSession[]>;
  private detached = false;
  readonly version: string;

  constructor(
    /** Relay's registry folder: each host writes its record here. */
    private dir: string,
    /** The host's bundled script. */
    private script: string,
  ) {
    this.version = createHash("sha256")
      .update(readFileSync(script))
      .digest("hex")
      .slice(0, 16);
  }

  /** Who answers the agents' calls to Relay's tools, once Relay can. */
  get tools() {
    return this.toolSlot.handler;
  }

  set tools(handler: ToolHandler | undefined) {
    this.toolSlot.fill(handler);
  }

  /** The hosts' process ids: the agents they start are Relay's own. */
  pids() {
    return this.connections.map((c) => c.pid);
  }

  /**
   * Connects to every host still running, once. Sessions come back with
   * their logs; an older host takes no new ones and exits when they end.
   */
  discover(): Promise<FoundSession[]> {
    this.discovered ??= (async () => {
      const names = await readdir(this.dir).catch(() => [] as string[]);
      const found: FoundSession[] = [];
      for (const name of names) {
        if (!/^host-\d+\.json$/.test(name)) continue;
        const file = join(this.dir, name);
        let record: HostRecord;
        try {
          record = JSON.parse(await readFile(file, "utf8"));
        } catch {
          continue;
        }
        if (!alive(record.pid)) {
          await rm(file, { force: true });
          continue;
        }
        let connection: HostConnection;
        try {
          connection = await HostConnection.open(
            record,
            () => this.forget(connection),
            (signal) => this.toolSlot.waitFor(signal),
          );
        } catch (error) {
          console.warn("Could not reach an agent host:", error);
          continue;
        }
        this.connections.push(connection);
        if (record.version !== this.version) connection.drain();
        for (const info of connection.sessions)
          found.push({
            info,
            draining: connection.draining,
            attach: (h) => connection.attach(info, h),
            attachProcess: () => connection.attachProcess(info),
            close: () => connection.send({ t: "close", session: info.id }),
          });
      }
      return found;
    })();
    return this.discovered;
  }

  async open(request: HostedOpen) {
    const connection = await this.current();
    return connection.open(request);
  }

  async openProcess(request: HostedProcessOpen) {
    const connection = await this.current();
    return connection.openProcess(request);
  }

  /** A host of this version is running, so Relay's tools are served. */
  async ensure() {
    await this.current();
  }

  /** Relay is restarting: let go of the hosts and leave their sessions running. */
  detach() {
    this.detached = true;
    for (const connection of this.connections) connection.detach();
  }

  private forget(connection: HostConnection) {
    this.connections = this.connections.filter((c) => c !== connection);
  }

  private async current() {
    if (this.detached) throw new Error("Relay is closing.");
    await this.discover();
    const live = this.connections.find(
      (c) => c.version === this.version && !c.draining && !c.closed,
    );
    if (live) return live;
    this.starting ??= this.start().finally(() => (this.starting = undefined));
    return this.starting;
  }

  private async start() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const child = spawn(
      process.execPath,
      [this.script, "--relay-agent-host", this.dir],
      {
        cwd: this.dir,
        detached: true,
        stdio: "ignore",
        // Under plain Node (a headless Relay) Windows would give it a console window.
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
    );
    const exited = new Promise<never>((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`The agent host exited (${code}).`)),
      );
    });
    void exited.catch(() => {});
    child.unref();
    const file = join(this.dir, `host-${child.pid}.json`);
    const record = await Promise.race([
      exited,
      (async () => {
        for (let waited = 0; waited < 10_000; waited += 50) {
          try {
            return JSON.parse(await readFile(file, "utf8")) as HostRecord;
          } catch {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        child.kill();
        throw new Error("The agent host did not start.");
      })(),
    ]);
    child.removeAllListeners();
    // A host hanging up before its welcome calls back before this is set.
    let connection: HostConnection;
    connection = await HostConnection.open(
      record,
      () => this.forget(connection),
      (signal) => this.toolSlot.waitFor(signal),
    );
    this.connections.push(connection);
    return connection;
  }
}

export interface FoundSession {
  info: SessionInfo;
  /** Its host is older than this Relay and exits once its sessions end. */
  draining: boolean;
  attach: (handlers: HostedHandlers) => HostedQuery;
  attachProcess: () => HostedProcess;
  /** Nobody takes it back: end it. */
  close: () => void;
}

class HostConnection {
  sessions: SessionInfo[] = [];
  version = "";
  pid = 0;
  draining = false;
  closed = false;
  private detached = false;
  private endpoints = new Map<string, HostedQuery | HostedProcess>();
  private calls = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private nextCall = 1;
  /** Tool calls being answered, to stop when the agent gives up. */
  private toolCalls = new Map<number, AbortController>();

  private constructor(
    private socket: Socket,
    private onClose: () => void,
    private tools: (signal: AbortSignal) => Promise<ToolHandler>,
  ) {}

  static open(
    record: HostRecord,
    onClose: () => void,
    tools: (signal: AbortSignal) => Promise<ToolHandler>,
  ) {
    return new Promise<HostConnection>((resolve, reject) => {
      if (record.protocol !== protocolVersion)
        return reject(
          new Error(`The agent host speaks protocol ${record.protocol}.`),
        );
      const socket = connect(record.socket);
      const connection = new HostConnection(socket, onClose, tools);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("The agent host did not answer."));
      }, 5000);
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("close", () => {
        clearTimeout(timer);
        reject(new Error("The agent host closed the connection."));
        connection.lost();
      });
      socket.on("connect", () =>
        connection.send({
          t: "hello",
          token: record.token,
          protocol: protocolVersion,
        }),
      );
      readLines(socket, (message: HostMessage) => {
        if (message.t === "welcome") {
          clearTimeout(timer);
          connection.version = message.version;
          connection.pid = message.pid;
          connection.sessions = message.sessions;
          connection.draining = message.draining === true;
          resolve(connection);
        } else if (message.t === "refused") {
          clearTimeout(timer);
          reject(new Error(message.error));
        } else connection.receive(message);
      });
    });
  }

  send(message: ClientMessage) {
    writeLine(this.socket, message);
  }

  /** Past `timeout`, a host that stopped answering no longer holds the caller. */
  call(session: string, method: string, args: unknown[], timeout?: number) {
    if (this.closed)
      return Promise.reject(new Error("The agent host has stopped."));
    const id = this.nextCall++;
    return new Promise<any>((resolve, reject) => {
      const timer =
        timeout === undefined
          ? undefined
          : setTimeout(() => {
              this.calls.delete(id);
              reject(
                new Error(`The agent host didn't answer ${method} in time.`),
              );
            }, timeout);
      this.calls.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.send({ t: "call", id, session, method, args });
    });
  }

  open(request: HostedOpen) {
    const id = randomUUID();
    const query = new HostedQuery(this, id, request.handlers, -1);
    this.endpoints.set(id, query);
    this.send({
      t: "open",
      session: id,
      key: request.key,
      meta: request.meta,
      options: request.options,
      hooks: request.hooks,
      canUseTool: !!request.handlers.canUseTool,
      onElicitation: !!request.handlers.onElicitation,
    });
    return query;
  }

  attach(info: SessionInfo, handlers: HostedHandlers) {
    const query = new HostedQuery(this, info.id, handlers, info.split);
    return this.takeBack(info, query);
  }

  openProcess(request: HostedProcessOpen) {
    const id = randomUUID();
    const running = new HostedProcess(this, id);
    this.endpoints.set(id, running);
    this.send({
      t: "open",
      session: id,
      key: request.key,
      meta: request.meta,
      options: {},
      hooks: {},
      canUseTool: false,
      process: request.process,
    });
    return running;
  }

  attachProcess(info: SessionInfo) {
    return this.takeBack(info, new HostedProcess(this, info.id, info));
  }

  /** A session found running; a host that died since has nothing to replay, only its end. */
  private takeBack<T extends HostedQuery | HostedProcess>(
    info: SessionInfo,
    endpoint: T,
  ) {
    this.endpoints.set(info.id, endpoint);
    if (this.closed) ended(endpoint);
    else this.send({ t: "attach", session: info.id });
    return endpoint;
  }

  forget(id: string) {
    this.endpoints.delete(id);
  }

  drain() {
    this.draining = true;
    this.send({ t: "drain" });
  }

  detach() {
    this.detached = true;
    this.socket.destroy();
  }

  private receive(message: HostMessage) {
    switch (message.t) {
      case "entry":
        if (
          message.entry.kind === "end" &&
          message.entry.failure === closingFailure
        )
          this.draining = true;
        this.endpoints.get(message.session)?.entry(message.entry);
        return;
      case "attached":
        this.endpoints.get(message.session)?.attached();
        return;
      case "return": {
        const call = this.calls.get(message.id);
        this.calls.delete(message.id);
        if (message.error !== undefined) call?.reject(new Error(message.error));
        else call?.resolve(message.value);
        return;
      }
      case "ask": {
        const endpoint = this.endpoints.get(message.session);
        if (endpoint instanceof HostedQuery) endpoint.ask(message);
        return;
      }
      case "cancel":
        for (const endpoint of this.endpoints.values())
          if (endpoint instanceof HostedQuery) endpoint.cancel(message.id);
        return;
      case "tool":
        void this.tool(message);
        return;
      case "toolCancel":
        this.toolCalls.get(message.id)?.abort();
        return;
    }
  }

  private async tool(message: Extract<HostMessage, { t: "tool" }>) {
    const abort = new AbortController();
    this.toolCalls.set(message.id, abort);
    let result: ToolResult;
    try {
      const handler = await this.tools(abort.signal);
      result = await handler(
        message.chatId,
        message.name,
        message.args,
        abort.signal,
      );
    } catch (error) {
      result = toolText(errorMessage(error), true);
    } finally {
      this.toolCalls.delete(message.id);
    }
    if (!this.closed) this.send({ t: "toolResult", id: message.id, result });
  }

  /** The host went away: its sessions ended with it, unless Relay let go first. */
  private lost() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
    for (const abort of this.toolCalls.values()) abort.abort();
    if (this.detached) return;
    for (const call of this.calls.values())
      call.reject(new Error("The agent host has stopped."));
    this.calls.clear();
    for (const endpoint of this.endpoints.values()) ended(endpoint);
  }
}

/** The host is gone: the session ends, and a replay under way is over with it. */
function ended(endpoint: HostedQuery | HostedProcess) {
  endpoint.entry({ seq: -1, kind: "end", failure: "The agent host stopped." });
  endpoint.attached();
}
