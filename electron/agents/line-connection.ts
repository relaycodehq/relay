import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { HostedChild } from "../agent-host/child";

export type RpcId = string | number;
export type Settled = { result?: unknown; error?: Error };

type Waiter = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/** How much of what the process printed to stderr is kept, for explaining a failure. */
const STDERR_TAIL = 8000;

/**
 * A process spoken to in JSON lines over stdio, run here or in the agent
 * host: its requests and their replies, including replies that came while
 * nobody waited (a turn that finished while Relay was away), and the end of
 * it. What the lines look like is the subclass's.
 */
export abstract class LineConnection {
  closed = false;
  private closing = false;
  /** Why it closed, for whoever asks after. */
  protected reason?: string;
  private nextId = 1;
  private waiting = new Map<RpcId, Waiter>();
  private orphans = new Map<RpcId, Settled>();
  private stderr = "";
  onClose?: (reason: string) => void;

  constructor(
    readonly child: ChildProcessWithoutNullStreams | HostedChild,
    /** As messages name the process. */
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

  /** The end of what the process wrote to stderr, which often says why it failed. */
  get log() {
    return this.stderr.trim();
  }

  protected abstract read(line: string): void;

  /** Ends the process once closed; `close` has already failed what waited. */
  protected abstract stop(child: ChildProcessWithoutNullStreams): void;

  /** What waiters are failed with when it ends. */
  protected endError(reason: string) {
    return new Error(reason);
  }

  /** Hands request `id` its reply, or keeps it for whoever asks later. */
  protected settle(id: RpcId, settled: Settled) {
    const waiter = this.waiting.get(id);
    if (!waiter) return void this.orphans.set(id, settled);
    this.waiting.delete(id);
    if (settled.error) waiter.reject(settled.error);
    else waiter.resolve(settled.result);
  }

  /** The method request `id` was for, as far as anyone waits for it. */
  protected methodOf(id: RpcId) {
    return this.waiting.get(id)?.method ?? "";
  }

  protected end(reason: string) {
    if (this.closed && this.reason) return;
    this.closed = true;
    this.reason = reason;
    const error = this.endError(reason);
    for (const waiter of this.waiting.values()) waiter.reject(error);
    this.waiting.clear();
    this.onClose?.(reason);
  }

  protected stopped() {
    return new Error(this.reason ?? `${this.name} stopped.`);
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

  /** The reply to request `id`, which may already be in. */
  wait(id: RpcId, method = ""): Promise<unknown> {
    const early = this.orphans.get(id);
    if (early) {
      this.orphans.delete(id);
      return early.error
        ? Promise.reject(early.error)
        : Promise.resolve(early.result);
    }
    if (this.closed) return Promise.reject(this.stopped());
    return new Promise((resolve, reject) =>
      this.waiting.set(id, { method, resolve, reject }),
    );
  }

  /** Sends `line` unless it has ended. */
  protected send(line: string) {
    if (this.closed) return;
    this.child.stdin.write(line + "\n");
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
    this.end(`${this.name} was closed.`);
    const { child } = this;
    // The host stops one it runs the same way.
    if (child instanceof HostedChild) child.kill();
    else this.stop(child);
  }
}
