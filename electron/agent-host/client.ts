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
  protocolVersion,
  readLines,
  writeLine,
  type ClientMessage,
  type Entry,
  type HookFrame,
  type HookMode,
  type HostMessage,
  type HostRecord,
  type ProcessSpec,
  type SessionInfo,
} from "./protocol";
import { AsyncQueue } from "../util/async-queue";

/**
 * How long a session's control call may take. Claude Code answers them at
 * once, even mid-turn, so a slower one met a stuck host or CLI. 20 seconds is
 * what Relay already gives a freshly started CLI to answer the same requests
 * when it lists models and commands.
 */
const callLimit = 20_000;

/** What the host asks of Relay while a session runs. */
export interface HostedHandlers {
  canUseTool?: (
    tool: string,
    input: Record<string, unknown>,
    context: Record<string, unknown> & { signal: AbortSignal },
  ) => Promise<unknown>;
  onElicitation?: (
    request: Record<string, unknown>,
    context: { signal: AbortSignal },
  ) => Promise<unknown>;
  hooks: Record<string, (input: unknown) => Promise<unknown>>;
}

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

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export class AgentHosts {
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
          connection = await HostConnection.open(record, () =>
            this.forget(connection),
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
    const connection = await HostConnection.open(record, () =>
      this.forget(connection),
    );
    this.connections.push(connection);
    return connection;
  }
}

export interface FoundSession {
  info: SessionInfo;
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

  private constructor(
    private socket: Socket,
    private onClose: () => void,
  ) {}

  static open(record: HostRecord, onClose: () => void) {
    return new Promise<HostConnection>((resolve, reject) => {
      if (record.protocol !== protocolVersion)
        return reject(
          new Error(`The agent host speaks protocol ${record.protocol}.`),
        );
      const socket = connect(record.socket);
      const connection = new HostConnection(socket, onClose);
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
    this.endpoints.set(info.id, query);
    this.send({ t: "attach", session: info.id });
    return query;
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
    const running = new HostedProcess(this, info.id, info);
    this.endpoints.set(info.id, running);
    this.send({ t: "attach", session: info.id });
    return running;
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
    }
  }

  /** The host went away: its sessions ended with it, unless Relay let go first. */
  private lost() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
    if (this.detached) return;
    for (const call of this.calls.values())
      call.reject(new Error("The agent host has stopped."));
    this.calls.clear();
    for (const endpoint of this.endpoints.values())
      endpoint.entry({
        seq: -1,
        kind: "end",
        failure: "The agent host stopped.",
      });
  }
}

/**
 * Stands in for the SDK's query: frames come off the host's log, calls go to
 * the query running there. `split` marks where replayed frames stop only
 * restoring state and start being a turn to show.
 */
export class HostedQuery {
  private entries = new AsyncQueue<Entry>();
  private closed = false;
  private seqs = new WeakMap<object, number>();
  private asking = new Map<number, AbortController>();

  constructor(
    private connection: HostConnection,
    private id: string,
    private handlers: HostedHandlers,
    readonly split: number,
  ) {}

  entry(entry: Entry) {
    this.entries.push(entry);
  }

  /** The replay is over; `split` already told replay from live. */
  attached() {}

  /** Where a frame sits in the host's log. */
  seqOf(frame: object) {
    return this.seqs.get(frame);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<any, void> {
    for await (const entry of this.entries) {
      if (entry.kind === "end") {
        this.connection.forget(this.id);
        if (entry.failure) throw new Error(entry.failure);
        return;
      }
      if (entry.kind !== "frame" && entry.kind !== "hook") continue;
      const frame =
        entry.kind === "frame"
          ? (entry.message as object)
          : ({
              type: "relay_hook",
              event: entry.event,
              input: entry.input,
            } satisfies HookFrame);
      this.seqs.set(frame, entry.seq);
      yield frame;
    }
  }

  ask(message: Extract<HostMessage, { t: "ask" }>) {
    const controller = new AbortController();
    this.asking.set(message.id, controller);
    const run = async () => {
      if (message.name === "canUseTool") {
        const [tool, input, context] = message.args as [
          string,
          Record<string, unknown>,
          Record<string, unknown>,
        ];
        if (!this.handlers.canUseTool)
          throw new Error("This session asks no permissions.");
        return this.handlers.canUseTool(tool, input, {
          ...context,
          signal: controller.signal,
        });
      }
      if (message.name === "onElicitation") {
        if (!this.handlers.onElicitation)
          throw new Error("This session answers no MCP requests.");
        return this.handlers.onElicitation(
          message.args[0] as Record<string, unknown>,
          { signal: controller.signal },
        );
      }
      const [event, input] = message.args as [string, unknown];
      return (await this.handlers.hooks[event]?.(input)) ?? {};
    };
    void run().then(
      (value) => this.answer(message.id, { value }),
      (error) =>
        this.answer(message.id, {
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  cancel(id: number) {
    this.asking.get(id)?.abort();
    this.asking.delete(id);
  }

  private answer(id: number, result: { value?: unknown; error?: string }) {
    if (!this.asking.delete(id)) return;
    this.connection.send({ t: "answer", id, ...result });
  }

  push(message: unknown) {
    if (!this.closed)
      this.connection.send({ t: "push", session: this.id, message });
  }

  /** A turn starts or ends; `at` is the log position, when Relay knows it. */
  mark(mark: "start" | "end", at?: number) {
    if (!this.closed)
      this.connection.send({
        t: "mark",
        session: this.id,
        mark,
        ...(at !== undefined ? { at } : {}),
      });
  }

  abort() {
    if (!this.closed) this.connection.send({ t: "abort", session: this.id });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.connection.send({ t: "close", session: this.id });
    this.connection.forget(this.id);
    for (const controller of this.asking.values()) controller.abort();
    this.asking.clear();
    this.entry({ seq: -1, kind: "end" });
  }

  private call(method: string, ...args: unknown[]) {
    return this.connection.call(this.id, method, args, callLimit);
  }
  interrupt() {
    return this.call("interrupt");
  }
  setModel(model?: string) {
    return this.call("setModel", model);
  }
  setPermissionMode(mode: string) {
    return this.call("setPermissionMode", mode);
  }
  applyFlagSettings(settings: Record<string, unknown>) {
    return this.call("applyFlagSettings", settings);
  }
  getSettings() {
    return this.call("getSettings");
  }
  getContextUsage(options?: { detail?: "summary" | "full" }) {
    return this.call("getContextUsage", options);
  }
  accountInfo() {
    return this.call("accountInfo");
  }
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(options?: {
    skipBehaviors?: boolean;
  }) {
    return this.call(
      "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET",
      options,
    );
  }
  /** The signal stays here: an answer that comes too late is dropped. */
  askSideQuestion(
    question: string,
    options?: { history?: unknown[]; signal?: AbortSignal },
  ) {
    // A whole answer, so no limit; the caller's signal cancels it.
    const asked = this.connection.call(this.id, "askSideQuestion", [
      question,
      { history: options?.history },
    ]);
    const signal = options?.signal;
    if (!signal) return asked;
    return Promise.race([
      asked,
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error("Cancelled by you."));
        signal.addEventListener(
          "abort",
          () => reject(new Error("Cancelled by you.")),
          { once: true },
        );
      }),
    ]);
  }
  stopTask(taskId: string) {
    return this.call("stopTask", taskId);
  }
  supportedCommands() {
    return this.call("supportedCommands");
  }
  /** A host older than this Relay refuses it. */
  supportedAgents() {
    return this.call("supportedAgents");
  }
}

export interface ProcessReader {
  replayed?: (entries: Entry[]) => void;
  entry: (entry: Entry) => void;
}

/**
 * A process the host runs for Relay, e.g. Codex's app server: its output
 * lines come off the host's log, and what Relay writes goes to its input.
 * Picked up after a restart, the log comes first, marked as replayed.
 */
export class HostedProcess {
  private reader?: ProcessReader;
  private replay: Entry[] = [];
  private live: Entry[] = [];
  private replaying: boolean;
  private closed = false;

  constructor(
    private connection: HostConnection,
    private id: string,
    /** What the host said about it, when picked up after a restart. */
    readonly info?: SessionInfo,
  ) {
    this.replaying = !!info;
  }

  /** Hands over the replayed log in one piece, once it's all in, then each entry as it comes. */
  read(reader: ProcessReader) {
    this.reader = reader;
    if (!this.replaying && this.info) reader.replayed?.(this.replay.splice(0));
    for (const entry of this.live.splice(0)) reader.entry(entry);
  }

  entry(entry: Entry) {
    // Mid-replay the endpoint stays: "attached" still has to find it.
    if (entry.kind === "end" && !this.replaying)
      this.connection.forget(this.id);
    if (this.replaying) this.replay.push(entry);
    else if (this.reader) this.reader.entry(entry);
    else this.live.push(entry);
  }

  attached() {
    this.replaying = false;
    if (this.replay.some((e) => e.kind === "end"))
      this.connection.forget(this.id);
    this.reader?.replayed?.(this.replay.splice(0));
  }

  write(line: string) {
    if (!this.closed)
      this.connection.send({ t: "push", session: this.id, message: line });
  }

  /** A turn starts or ends; `turn` names one of several a shared process runs. */
  mark(mark: "start" | "end", options: { at?: number; turn?: string } = {}) {
    if (!this.closed)
      this.connection.send({ t: "mark", session: this.id, mark, ...options });
  }

  /** What the next Relay reads about this process, replacing what it had. */
  keep(meta: unknown) {
    if (!this.closed)
      this.connection.send({ t: "meta", session: this.id, meta });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.connection.send({ t: "close", session: this.id });
    this.connection.forget(this.id);
  }
}
