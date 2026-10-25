import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { HostedChild } from "../../agent-host/child";
import type { Entry } from "../../agent-host/protocol";
import { terminate } from "../../platform/terminate";
import { withTimeout } from "../../util/timeout";
import { z } from "zod";
import { HostedSessions, savedMeta } from "../hosted-sessions";
import { LineConnection } from "../line-connection";
import { cursorSetup } from "./sdk";
import type { InstalledSdk } from "./sdk-install";
import {
  isEvent,
  isLoginUrl,
  isReply,
  type CursorMethod,
  type CursorMethods,
  type CursorUpdate,
} from "./protocol";
import { withWorktreeEnv } from "../worktree-env";

/** What a hosted worker keeps for the next Relay: its agent, and the turn it was in. */
export const cursorMetaSchema = z
  .object({
    provider: z.literal("cursor"),
    agentId: z.string().optional(),
    run: z.object({ run: z.string(), id: z.number() }).optional(),
  })
  .loose();
export type CursorMeta = z.infer<typeof cursorMetaSchema>;

/** An error the worker reported, keeping the SDK's name for it, e.g. `AuthenticationError`. */
export class CursorError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** One worker process, and the requests and turn updates that go through it. */
export class CursorConnection extends LineConnection {
  busy = false;
  /** The turn a restart cut off, for an `adopt` turn to show. */
  inflight?: { run: string; id: number };
  private listeners = new Map<string, (update: CursorUpdate) => void>();
  /** Hears the sign-in page of an `auth.login` asked not to open a browser. */
  onLoginUrl?: (url: string) => void;

  constructor(
    child: ChildProcessWithoutNullStreams | HostedChild,
    /** Runs once the worker is gone, e.g. to delete what it kept for a one-off job. */
    private readonly cleanup?: () => Promise<void>,
  ) {
    super(child, "Cursor's worker");
  }

  protected read(line: string) {
    let said: unknown;
    try {
      said = JSON.parse(line);
    } catch {
      return;
    }
    if (isEvent(said)) this.listeners.get(said.run)?.(said.update);
    else if (isLoginUrl(said)) this.onLoginUrl?.(said.url);
    else if (isReply(said))
      this.settle(
        said.id,
        "error" in said
          ? { error: new CursorError(said.error.name, said.error.message) }
          : { result: said.result },
      );
  }

  request<M extends CursorMethod>(
    method: M,
    params: CursorMethods[M]["params"],
    id = this.reserve(),
  ): Promise<CursorMethods[M]["result"]> {
    if (this.closed) return Promise.reject(this.stopped());
    const reply = this.wait(id, method) as Promise<CursorMethods[M]["result"]>;
    this.send(JSON.stringify({ id, method, params }));
    return reply;
  }

  listen(run: string, handler: (update: CursorUpdate) => void) {
    this.listeners.set(run, handler);
  }

  unlisten(run: string) {
    this.listeners.delete(run);
  }

  /** What the next Relay reads about this worker, replacing what it had. */
  override keep(meta: Omit<CursorMeta, "provider">) {
    super.keep({ provider: "cursor", ...meta } satisfies CursorMeta);
  }

  private cleaning = false;

  override close() {
    if (!this.cleaning) {
      this.cleaning = true;
      this.child.once("exit", () => void this.cleanup?.());
    }
    super.close();
  }

  protected stop(child: ChildProcessWithoutNullStreams) {
    // Closing its input is how a worker is told to stop; the kill is for one that doesn't.
    terminate(child, { byInput: true });
  }
}

function command(
  sdk: InstalledSdk,
  store = cursorSetup().store,
  env: Record<string, string> = {},
) {
  const { worker } = cursorSetup();
  return {
    command: process.execPath,
    args: [worker, "--sdk", sdk.entry, "--store", store],
    // Electron's binary runs the worker as plain Node.
    env: withWorktreeEnv(process.env as Record<string, string>, {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
    }),
  };
}

const sessions = new HostedSessions<CursorConnection>({
  provider: "cursor",
  name: "Cursor",
  kind: "process",
  close: (connection) => connection.close(),
});

/**
 * The worker for a thread's session, started if it isn't running. A thread's
 * runs in the agent host; without a key it's a private one that ends with its turn.
 */
export function acquireCursorConnection(
  key: string | undefined,
  cwd: string,
  sdk: InstalledSdk,
  env?: Record<string, string>,
): Promise<CursorConnection> {
  return sessions.acquire(key, async () => {
    if (key)
      return new CursorConnection(
        await launch(key, cwd, sdk, threadStore(key), env),
      );
    // A one-off job leaves no agent behind: its history goes with it.
    const parent = cursorSetup().store;
    await mkdir(parent, { recursive: true });
    const store = await mkdtemp(join(parent, "tmp-"));
    return new CursorConnection(await launch(undefined, cwd, sdk, store), () =>
      rm(store, { recursive: true, force: true }),
    );
  });
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

function launch(
  key: string | undefined,
  cwd: string,
  sdk: InstalledSdk,
  store?: string,
  env?: Record<string, string>,
) {
  const spec = command(sdk, store, env);
  return sessions.spawn(
    key,
    { provider: "cursor" } satisfies CursorMeta,
    { ...spec, cwd, group: false, stopByInput: true },
    () =>
      spawn(spec.command, spec.args, {
        cwd,
        env: spec.env,
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams,
  );
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
  onLoginUrl?: (url: string) => void,
): Promise<CursorMethods[M]["result"]> {
  const spec = command(sdk);
  const connection = new CursorConnection(
    spawn(spec.command, spec.args, {
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams,
  );
  connection.onLoginUrl = onLoginUrl;
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

export function closeCursorConnection(key: string) {
  return sessions.close(key);
}

/** Relay is quitting: workers in the host keep going, the rest end. */
export function detachCursor() {
  sessions.detach();
}

export function disposeCursor() {
  sessions.dispose();
}

/**
 * Takes back the workers the agent host kept running while Relay restarted.
 * One in a turn waits, holding what it said meanwhile, for an `adopt` turn.
 */
export function reattachCursorSessions(owns: (key: string) => boolean) {
  return sessions.reattach(owns, (found) => {
    const { info } = found;
    const meta = savedMeta(found, cursorMetaSchema);
    if (!meta) return;
    const inflight = meta.run;
    const child = new HostedChild(found.attachProcess(), (entries) => {
      connection.continueAfter(
        Math.max(inflight?.id ?? 0, highestRequestId(entries)),
      );
      return cursorReplay(entries, info.split);
    });
    const connection = new CursorConnection(child);
    connection.inflight = inflight;
    if (!info.open) child.release();
    return connection;
  });
}

/** What a turn cut off by a restart still has to hear: its updates and its reply. */
function cursorReplay(entries: Entry[], split: number): string[] {
  return entries
    .filter((entry) => entry.kind === "line" && entry.seq >= split)
    .map((entry) => (entry as Extract<Entry, { kind: "line" }>).text);
}

/** The highest request id the log mentions, in what Relay sent or the worker answered. */
function highestRequestId(entries: Entry[]) {
  let highest = 0;
  for (const entry of entries) {
    if (entry.kind !== "line" && entry.kind !== "input") continue;
    try {
      const id = JSON.parse(entry.text)?.id;
      if (typeof id === "number") highest = Math.max(highest, id);
    } catch {}
  }
  return highest;
}
