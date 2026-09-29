import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { HostedChild } from "../../agent-host/child";
import type { AgentHosts } from "../../agent-host/client";
import type { Entry } from "../../agent-host/protocol";
import { withTimeout } from "../../timeout";
import { cursorSetup } from "./sdk";
import type { InstalledSdk } from "./sdk-install";
import {
  isEvent,
  isReply,
  type CursorMethod,
  type CursorMethods,
  type CursorUpdate,
} from "./protocol";

let hosts: AgentHosts | undefined;
/** Runs threads' workers in the agent host, so they outlive a restart of Relay. */
export function useCursorHosts(agentHosts: AgentHosts) {
  hosts = agentHosts;
}

/** What a hosted worker keeps for the next Relay: its agent, and the turn it was in. */
export interface CursorMeta {
  provider: "cursor";
  agentId?: string;
  run?: { run: string; id: number };
}

/** An error the worker reported, keeping the SDK's name for it, e.g. `AuthenticationError`. */
export class CursorError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** One worker process, and the requests and turn updates that go through it. */
export class CursorConnection {
  busy = false;
  closed = false;
  private closing = false;
  /** The turn a restart cut off, for an `adopt` turn to show. */
  inflight?: { run: string; id: number };
  private nextRequest = 1;
  private waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  /** Replies nobody asked for yet: a turn that finished while Relay was away. */
  private orphans = new Map<number, { result?: unknown; error?: Error }>();
  private listeners = new Map<string, (update: CursorUpdate) => void>();

  constructor(
    readonly child: ChildProcessWithoutNullStreams | HostedChild,
    /** Runs once the worker is gone, e.g. to delete what it kept for a one-off job. */
    private readonly cleanup?: () => Promise<void>,
  ) {
    child.stderr.resume();
    // The stream's end, not the exit, so a reply that came just before it is read first.
    createInterface({ input: child.stdout })
      .on("line", (line) => this.read(line))
      .on("close", () => this.end("Cursor's worker stopped."));
    child.stdin.on("error", () => this.end("Cursor's worker closed."));
  }

  private read(line: string) {
    let said: unknown;
    try {
      said = JSON.parse(line);
    } catch {
      return;
    }
    if (isEvent(said)) {
      this.listeners.get(said.run)?.(said.update);
    } else if (isReply(said)) {
      const settled =
        "error" in said
          ? { error: new CursorError(said.error.name, said.error.message) }
          : { result: said.result };
      const waiter = this.waiting.get(said.id);
      if (!waiter) return void this.orphans.set(said.id, settled);
      this.waiting.delete(said.id);
      if (settled.error) waiter.reject(settled.error);
      else waiter.resolve(settled.result);
    }
  }

  private end(reason: string) {
    this.closed = true;
    for (const waiter of this.waiting.values())
      waiter.reject(new Error(reason));
    this.waiting.clear();
  }

  /** The id the next request gets, for keeping with the worker before it goes out. */
  reserve() {
    return this.nextRequest++;
  }

  request<M extends CursorMethod>(
    method: M,
    params: CursorMethods[M]["params"],
    id = this.reserve(),
  ): Promise<CursorMethods[M]["result"]> {
    const reply = this.wait(id) as Promise<CursorMethods[M]["result"]>;
    if (this.closed)
      return Promise.reject(new Error("Cursor's worker stopped."));
    this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    return reply;
  }

  /** The reply to request `id`, which may already be in. */
  wait(id: number): Promise<unknown> {
    const early = this.orphans.get(id);
    if (early) {
      this.orphans.delete(id);
      return early.error
        ? Promise.reject(early.error)
        : Promise.resolve(early.result);
    }
    return new Promise((resolve, reject) =>
      this.waiting.set(id, { resolve, reject }),
    );
  }

  listen(run: string, handler: (update: CursorUpdate) => void) {
    this.listeners.set(run, handler);
  }
  unlisten(run: string) {
    this.listeners.delete(run);
  }

  private get hosted() {
    return this.child instanceof HostedChild ? this.child.hosted : undefined;
  }
  /** What the next Relay reads about this worker, replacing what it had. */
  keep(meta: Omit<CursorMeta, "provider">) {
    this.hosted?.keep({ provider: "cursor", ...meta } satisfies CursorMeta);
  }
  /** Marks a turn in the host's log, so a restart knows one was running. */
  mark(mark: "start" | "end") {
    this.hosted?.mark(mark);
  }
  /** Lets through what a worker said while Relay was away, once someone listens. */
  resume() {
    if (this.child instanceof HostedChild) this.child.release();
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.closed = true;
    const { child } = this;
    // Closing its input is how a worker is told to stop; the kill is for one that doesn't.
    child.stdin.end();
    const kill = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2000);
    kill.unref();
    child.once("exit", () => {
      clearTimeout(kill);
      void this.cleanup?.();
    });
    if (child instanceof HostedChild) child.kill("SIGTERM");
  }
}

function command(sdk: InstalledSdk, store = cursorSetup().store) {
  const { worker } = cursorSetup();
  return {
    command: process.execPath,
    args: [worker, "--sdk", sdk.entry, "--store", store],
    // Electron's binary runs the worker as plain Node.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } as Record<
      string,
      string
    >,
  };
}

const sessions = new Map<string, CursorConnection>();

/**
 * The worker for a thread's session, started if it isn't running. A thread's
 * runs in the agent host; without a key it's a private one that ends with its turn.
 */
export async function acquireCursorConnection(
  key: string | undefined,
  cwd: string,
  sdk: InstalledSdk,
): Promise<CursorConnection> {
  let connection = key ? sessions.get(key) : undefined;
  if (connection?.busy)
    throw new Error("This Cursor session is already running a turn.");
  if (!connection || connection.closed) {
    if (key) {
      connection = new CursorConnection(
        await launch(key, cwd, sdk, threadStore(key)),
      );
      sessions.set(key, connection);
    } else {
      // A one-off job leaves no agent behind: its history goes with it.
      const parent = cursorSetup().store;
      await mkdir(parent, { recursive: true });
      const store = await mkdtemp(join(parent, "tmp-"));
      connection = new CursorConnection(
        await launch(undefined, cwd, sdk, store),
        () => rm(store, { recursive: true, force: true }),
      );
    }
  }
  connection.busy = true;
  return connection;
}

/**
 * Each thread's worker keeps its own store: the SDK rewrites a store's whole
 * agent list on every update and only locks within one process, so two workers
 * sharing one lose each other's agents ("Agent … not found").
 */
function threadStore(key: string) {
  const name = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return join(cursorSetup().store, "threads", name);
}

async function launch(
  key: string | undefined,
  cwd: string,
  sdk: InstalledSdk,
  store?: string,
) {
  const spec = command(sdk, store);
  const local = () =>
    spawn(spec.command, spec.args, {
      cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
  if (!key || !hosts) return local();
  try {
    const running = await hosts.openProcess({
      key,
      meta: { provider: "cursor" } satisfies CursorMeta,
      process: { ...spec, cwd, group: false },
    });
    const child = new HostedChild(running);
    child.release();
    return child;
  } catch (error) {
    console.warn("The agent host is unavailable; Cursor runs in Relay:", error);
    return local();
  }
}

/**
 * One question to a private worker, e.g. the model list; it ends with the
 * answer, or when `timeout` runs out (a sign-in nobody finishes).
 */
export async function cursorCall<M extends CursorMethod>(
  sdk: InstalledSdk,
  method: M,
  params: CursorMethods[M]["params"],
  timeout = 60_000,
): Promise<CursorMethods[M]["result"]> {
  const spec = command(sdk);
  const connection = new CursorConnection(
    spawn(spec.command, spec.args, {
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams,
  );
  try {
    return await withTimeout(
      connection.request(method, params),
      timeout,
      `Cursor didn't answer ${method} in time.`,
    );
  } finally {
    connection.close();
  }
}

export async function closeCursorConnection(key: string) {
  const connection = sessions.get(key);
  sessions.delete(key);
  connection?.close();
}

/** Relay is quitting: workers in the host keep going, the rest end. */
export function detachCursor() {
  sessions.clear();
}
export function disposeCursor() {
  for (const connection of sessions.values()) connection.close();
  sessions.clear();
}

/**
 * Takes back the workers the agent host kept running while Relay restarted.
 * One in a turn waits, holding what it said meanwhile, for an `adopt` turn.
 */
export async function reattachCursorSessions(
  owns: (key: string) => boolean,
): Promise<{ key: string; open: boolean }[]> {
  if (!hosts) return [];
  const back: { key: string; open: boolean }[] = [];
  for (const found of await hosts.discover()) {
    const { info } = found;
    const meta = info.meta as CursorMeta | undefined;
    if (meta?.provider !== "cursor") continue;
    if (!owns(info.key) || sessions.has(info.key)) {
      found.close();
      continue;
    }
    const child = new HostedChild(found.attachProcess(), (entries) =>
      cursorReplay(entries, info.split),
    );
    const connection = new CursorConnection(child);
    connection.inflight = meta.run;
    sessions.set(info.key, connection);
    if (!info.open) child.release();
    back.push({ key: info.key, open: info.open });
  }
  return back;
}

/** What a turn cut off by a restart still has to hear: its updates and its reply. */
function cursorReplay(entries: Entry[], split: number): string[] {
  return entries
    .filter((entry) => entry.kind === "line" && entry.seq >= split)
    .map((entry) => (entry as Extract<Entry, { kind: "line" }>).text);
}
