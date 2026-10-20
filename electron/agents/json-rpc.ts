import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { HostedChild } from "../agent-host/child";
import { terminate } from "../platform/terminate";

export type RpcId = string | number;
type Settled = { result?: unknown; error?: Error };
type Waiter = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is RpcId =>
  typeof value === "string" || typeof value === "number";

/** How much of what the agent printed to stderr is kept, for explaining a failure. */
const STDERR_TAIL = 8000;

/** Shared JSON-line RPC transport and hosted-process lifecycle for ACP and MSP. */
export abstract class JsonRpcConnection {
  closed = false;
  private closing = false;
  /** Why it closed, for whoever asks after. */
  private reason?: string;
  private nextId = 1;
  private waiting = new Map<RpcId, Waiter>();
  /** Replies nobody waits for yet: a turn that finished while Relay was away. */
  private orphans = new Map<RpcId, Settled>();
  private stderr = "";
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
    if (typeof method === "string")
      return this.notification(method, message.params);
    if (!isId(id)) return;
    const error = isRecord(message.error) ? message.error : undefined;
    const waiter = this.waiting.get(id);
    const settled: Settled = error
      ? {
          error: this.requestError(error, waiter?.method ?? ""),
        }
      : { result: message.result };
    if (!waiter) return void this.orphans.set(id, settled);
    this.waiting.delete(id);
    if (settled.error) waiter.reject(settled.error);
    else waiter.resolve(settled.result);
  }

  protected abstract requestError(
    error: Record<string, unknown>,
    method: string,
  ): Error;
  protected abstract notification(method: string, params: unknown): void;

  protected answer(id: RpcId, method: string, _params: unknown) {
    this.write({
      id,
      error: { code: -32601, message: `Relay doesn't offer ${method}.` },
    });
  }

  protected write(message: object) {
    if (this.closed) return;
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n",
    );
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
    params: unknown = {},
    id: number = this.reserve(),
  ): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error(this.reason ?? `${this.name} stopped.`));
    const reply = this.wait(id, method) as Promise<T>;
    this.write({ id, method, params });
    return reply;
  }

  notify(method: string, params: unknown = {}) {
    this.write({ method, params });
  }

  /** The reply to request `id`, which may already be in. */
  wait(id: RpcId, method = ""): Promise<unknown> {
    const early = this.orphans.get(id);
    if (early) {
      this.orphans.delete(id);
      return early.error
        ? Promise.reject(early.error)
        : Promise.resolve(early.result);
    }
    if (this.closed)
      return Promise.reject(new Error(this.reason ?? `${this.name} stopped.`));
    return new Promise((resolve, reject) =>
      this.waiting.set(id, { method, resolve, reject }),
    );
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
