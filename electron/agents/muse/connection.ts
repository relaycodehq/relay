import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { HostedChild } from "../../agent-host/child";
import { terminate } from "../../platform/terminate";

/** A request `muse serve` answered with a JSON-RPC error. */
export class MuseRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    /** MSP's stable error category (`error.data.kind`), what Relay branches on. */
    readonly kind: string | undefined,
    readonly data: unknown,
    readonly method: string,
  ) {
    super(message);
    this.name = "MuseRequestError";
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

const STDERR_TAIL = 8000;

/**
 * One `muse serve` process: JSON-RPC 2.0, a message per line, both ways.
 * Notifications carry the session's view; Relay's commands go back as
 * requests.
 */
export class MuseConnection {
  closed = false;
  private closing = false;
  private reason?: string;
  private nextId = 1;
  private waiting = new Map<Id, Waiter>();
  /** Replies nobody waits for yet: a turn that finished while Relay was away. */
  private orphans = new Map<Id, Settled>();
  private stderr = "";
  onNotification?: (method: string, params: unknown) => void;
  onClose?: (reason: string) => void;

  constructor(readonly child: ChildProcessWithoutNullStreams | HostedChild) {
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-STDERR_TAIL);
    });
    // The stream's end, not the exit, so a reply that came just before it is read first.
    createInterface({ input: child.stdout })
      .on("line", (line) => this.read(line))
      .on("close", () => this.end("Muse Code stopped."));
    child.stdin.on("error", () => this.end("Muse Code closed its input."));
    child.on("error", (error: Error) =>
      this.end(`Could not start Muse Code: ${error.message}`),
    );
  }

  /** The end of what it wrote to stderr, which often says why it failed. */
  get log() {
    return this.stderr.trim();
  }

  private read(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    const { id, method } = message;
    if (typeof method === "string" && isId(id))
      // MSP serves its view as notifications; a request from the host is one
      // this Relay doesn't know, and refusing it beats leaving it to hang.
      return this.write({
        id,
        error: { code: -32601, message: `Relay doesn't offer ${method}.` },
      });
    if (typeof method === "string")
      return void this.onNotification?.(method, message.params);
    if (!isId(id)) return;
    const error = isRecord(message.error) ? message.error : undefined;
    const waiter = this.waiting.get(id);
    const settled: Settled = error
      ? {
          error: new MuseRequestError(
            typeof error.code === "number" ? error.code : -32603,
            typeof error.message === "string" ? error.message : "Muse Code failed.",
            isRecord(error.data) && typeof error.data.kind === "string"
              ? error.data.kind
              : undefined,
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

  request<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = this.nextId++;
    if (this.closed)
      return Promise.reject(new Error(this.reason ?? "Muse Code stopped."));
    const reply = this.wait(id, method) as Promise<T>;
    this.write({ id, method, params });
    return reply;
  }

  notify(method: string, params: object = {}) {
    this.write({ method, params });
  }

  private wait(id: Id, method: string): Promise<unknown> {
    const early = this.orphans.get(id);
    if (early) {
      this.orphans.delete(id);
      return early.error ? Promise.reject(early.error) : Promise.resolve(early.result);
    }
    return new Promise((resolve, reject) =>
      this.waiting.set(id, { method, resolve, reject }),
    );
  }

  /** Forgets replies nobody will ask for, e.g. to the last Relay's commands. */
  dropOrphans() {
    this.orphans.clear();
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
  /** Lets through what it said while Relay was away, once someone listens. */
  resume() {
    if (this.child instanceof HostedChild) this.child.release();
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.end("Muse Code was closed.");
    const { child } = this;
    if (child instanceof HostedChild) child.kill();
    // Its own group, so the commands it started stop with it.
    else terminate(child, { group: true });
  }
}
