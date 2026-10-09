import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { HostedChild } from "../../agent-host/child";
import { terminate } from "../../platform/terminate";

/** A request the agent answered with a JSON-RPC error. */
export class AcpRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data: unknown,
    readonly method: string,
  ) {
    super(message);
    this.name = "AcpRequestError";
  }
}

type Id = string | number;
type Settled = { result?: unknown; error?: Error };
type Waiter = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is Id =>
  typeof value === "string" || typeof value === "number";

/** How much of what the agent printed to stderr is kept, for explaining a failure. */
const STDERR_TAIL = 8000;

/**
 * One ACP agent process: JSON-RPC 2.0, a message per line, both ways. The
 * agent asks things too (permission to run a tool); `onRequest` answers.
 */
export class AcpConnection {
  busy = false;
  closed = false;
  private closing = false;
  /** Why it closed, for whoever asks after. */
  private reason?: string;
  private nextId = 1;
  private waiting = new Map<Id, Waiter>();
  /** Replies nobody waits for yet: a turn that finished while Relay was away. */
  private orphans = new Map<Id, Settled>();
  private listeners = new Map<string, (update: unknown) => void>();
  private stderr = "";
  onRequest?: (method: string, params: unknown) => Promise<unknown>;
  /** Hears every session's updates, including those nobody listens for yet. */
  onUpdate?: (update: unknown) => void;
  onClose?: (reason: string) => void;

  constructor(
    readonly child: ChildProcessWithoutNullStreams | HostedChild,
    /** As messages name the agent. */
    readonly name: string,
  ) {
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-STDERR_TAIL);
    });
    // The stream's end, not the exit, so a reply that came just before it is read first.
    createInterface({ input: child.stdout })
      .on("line", (line) => this.read(line))
      .on("close", () => this.end(`${name} stopped.`));
    child.stdin.on("error", () => this.end(`${name} closed its input.`));
    child.on("error", (error: Error) =>
      this.end(`Could not start ${name}: ${error.message}`),
    );
  }

  /** The end of what the agent wrote to stderr, which often says why it failed. */
  get log() {
    return this.stderr.trim();
  }

  private read(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // Some agents log to stdout before they start speaking JSON.
      return;
    }
    if (!isRecord(message)) return;
    const { id, method } = message;
    if (typeof method === "string" && isId(id))
      return void this.answer(id, method, message.params);
    if (typeof method === "string") {
      if (method === "session/update" && isRecord(message.params)) {
        const session = message.params.sessionId;
        this.onUpdate?.(message.params.update);
        if (typeof session === "string")
          this.listeners.get(session)?.(message.params.update);
      }
      return;
    }
    if (!isId(id)) return;
    const error = isRecord(message.error) ? message.error : undefined;
    const waiter = this.waiting.get(id);
    const settled: Settled = error
      ? {
          error: new AcpRequestError(
            typeof error.code === "number" ? error.code : -32603,
            typeof error.message === "string"
              ? error.message
              : `${this.name} failed.`,
            error.data,
            waiter?.method ?? "",
          ),
        }
      : { result: message.result };
    if (!waiter) return void this.orphans.set(id, settled);
    this.waiting.delete(id);
    if (settled.error) waiter.reject(settled.error);
    else waiter.resolve(settled.result);
  }

  private async answer(id: Id, method: string, params: unknown) {
    let reply: object;
    try {
      // Between turns nobody can answer; a permission asked then is declined.
      if (!this.onRequest && method === "session/request_permission")
        return void this.write({ id, result: { outcome: { outcome: "cancelled" } } });
      if (!this.onRequest)
        throw new AcpRequestError(-32601, `Unsupported: ${method}`, null, method);
      reply = { id, result: (await this.onRequest(method, params)) ?? null };
    } catch (error) {
      reply = {
        id,
        error: {
          code: error instanceof AcpRequestError ? error.code : -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    this.write(reply);
  }

  private write(message: object) {
    if (this.closed) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  }

  private end(reason: string) {
    if (this.closed && this.reason) return;
    this.closed = true;
    this.reason = reason;
    const log = this.log;
    const error = new Error(log ? `${reason}\n\n${log.slice(-2000)}` : reason);
    for (const waiter of this.waiting.values()) waiter.reject(error);
    this.waiting.clear();
    this.onClose?.(reason);
  }

  /** A process picked up again was numbered by the last Relay: carry on above its ids. */
  continueAfter(id: number) {
    this.nextId = Math.max(this.nextId, id + 1);
  }

  /** Forgets replies nobody will ask for, e.g. to the last Relay's cancels. */
  dropOrphans() {
    this.orphans.clear();
  }

  /** The id the next request gets, for keeping with the process before it goes out. */
  reserve() {
    return this.nextId++;
  }

  request<T = unknown>(
    method: string,
    params: unknown,
    id: number = this.reserve(),
  ): Promise<T> {
    const reply = this.wait(id, method) as Promise<T>;
    if (this.closed) {
      this.waiting.delete(id);
      return Promise.reject(new Error(this.reason ?? `${this.name} stopped.`));
    }
    this.write({ id, method, params });
    return reply;
  }

  notify(method: string, params: unknown) {
    this.write({ method, params });
  }

  /** The reply to request `id`, which may already be in. */
  wait(id: Id, method = ""): Promise<unknown> {
    const early = this.orphans.get(id);
    if (early) {
      this.orphans.delete(id);
      return early.error
        ? Promise.reject(early.error)
        : Promise.resolve(early.result);
    }
    return new Promise((resolve, reject) =>
      this.waiting.set(id, { method, resolve, reject }),
    );
  }

  /** Hears the session's `session/update`s, one listener per session. */
  listen(session: string, handler: (update: unknown) => void) {
    this.listeners.set(session, handler);
  }
  unlisten(session: string) {
    this.listeners.delete(session);
  }

  private get hosted() {
    return this.child instanceof HostedChild ? this.child.hosted : undefined;
  }
  /** What the next Relay reads about this process, replacing what it had. */
  keep(meta: unknown) {
    this.hosted?.keep(meta);
  }
  /** Marks a turn in the host's log, so a restart knows one was running. */
  mark(mark: "start" | "end") {
    this.hosted?.mark(mark);
  }
  /** Lets through what the agent said while Relay was away, once someone listens. */
  resume() {
    if (this.child instanceof HostedChild) this.child.release();
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.end(`${this.name} was closed.`);
    const { child } = this;
    if (child instanceof HostedChild) child.kill();
    // Its own group, so the tools it started stop with it.
    else terminate(child, { group: true });
  }
}
