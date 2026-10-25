import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { terminate } from "../../platform/terminate";
import { executableCommand, spawnExecutable } from "../../platform/executables";
import { withCodexTransport, type CodexTransport } from "./codex-transport";
import { HostedChild } from "../../agent-host/child";
import type { Entry } from "../../agent-host/protocol";
import { z } from "zod";
import type { CodexWatch } from "./codex-watch";
import { HostedSessions, savedMeta } from "../hosted-sessions";
import { threadStartedSchema, type CodexThreadStarted } from "./codex-schemas";
import { SYSTEM_ACCOUNT } from "../../../shared/agent-accounts";
import type { ThreadGoal } from "../../../shared/goal";
import { codexGoal } from "./codex-goal";
import { exitedError, stderrTail } from "../errors";
import type { ContextUsage } from "../../../shared/projects";
import { estimateCodexContext } from "./codex-context";

type ProcessEnd = { code: number | null; signal: NodeJS.Signals | null };

/** What a hosted app server keeps for the next Relay: the thread it started. */
export const codexMetaSchema = z
  .object({
    provider: z.literal("codex"),
    started: threadStartedSchema.optional(),
    account: z.string().optional(),
  })
  .loose();
type CodexMeta = z.infer<typeof codexMetaSchema>;

/** A native session owns its approvals. Keep its process alive between project turns. */
class CodexConnection {
  child?: ChildProcessWithoutNullStreams | HostedChild;
  readonly ready: Promise<CodexTransport>;
  readonly done: Promise<void>;
  started?: CodexThreadStarted;
  /** The account its app server signed in as; see agents/accounts. */
  account?: string;
  busy = false;
  closed = false;
  onNotification?: (method: string, params: unknown) => void;
  onRequest?: (method: string, params: any) => Promise<unknown>;
  onError?: (error: Error) => void;
  /** What its thread was started or resumed with; a side check's fork needs exactly this to read the cache. */
  threadSettings?: Record<string, unknown>;
  /** Side checks' forks by thread id: what they say goes to them, never to the turn. */
  private sides = new Map<string, (method: string, params: any) => void>();
  /** Its thread's `/goal` as Codex last reported it, between runs too. */
  goal?: ThreadGoal | null;
  /** Turns of its thread that are over for Relay, so late word of one ends nothing. */
  readonly pastTurns = new Set<string>();
  /** Watch state for "Flag what I'd miss", made the first time a turn asks. */
  watch?: CodexWatch;
  private release!: () => void;
  /** Why its process went, once it's going. */
  private death?: Promise<Error>;

  constructor(
    open: () => Promise<ChildProcessWithoutNullStreams | HostedChild>,
  ) {
    let ready!: (wire: CodexTransport) => void;
    this.ready = new Promise((resolve) => {
      ready = resolve;
    });
    const lifetime = new Promise<void>((resolve) => {
      this.release = resolve;
    });
    const fail = (error: Error) => {
      this.onError?.(error);
      void this.close();
    };
    this.done = open()
      .then((child) => {
        this.child = child;
        if (this.closed) return this.stop();
        child.on("error", (e: Error) =>
          fail(new Error(`Could not start Codex: ${e.message}`)),
        );
        const stderr = stderrTail(child.stderr);
        const exit = new Promise<ProcessEnd>((resolve) =>
          child.once("exit", (code: number | null, signal: NodeJS.Signals | null) =>
            resolve({ code, signal }),
          ),
        );
        // Its output ending or the exit, whichever comes first: an exit says
        // best why, with what the process said last.
        const ended = (noticed?: Error) => {
          if (this.death) return;
          this.death = (async () => {
            const how = await Promise.race([
              exit,
              new Promise<undefined>((r) => setTimeout(() => r(undefined), 300)),
            ]);
            if (!how || this.closed)
              return noticed ?? new Error("Codex stopped before finishing.");
            return exitedError(
              "Codex",
              // A hosted one's code is the host's; its own is in what it said.
              child instanceof HostedChild ? undefined : how,
              await stderr(),
              "Check your local Codex sign-in.",
            );
          })();
          void this.death.then(fail);
        };
        child.on("exit", () => ended());
        child.stdin.on("error", () =>
          ended(new Error("The Codex connection closed.")),
        );
        return withCodexTransport(
          // Hosted or not, it reads and writes like the child it was.
          child as ChildProcessWithoutNullStreams,
          (method, params) => {
            const side = this.sides.get(threadOf(params));
            if (side) return side(method, params);
            if (method === "thread/goal/cleared") this.goal = null;
            if (method === "thread/goal/updated")
              this.goal =
                codexGoal((params as { goal?: unknown })?.goal) ?? this.goal;
            if (this.onNotification) this.onNotification(method, params);
            else this.unheard(method, params);
          },
          ended,
          async (wire) => {
            ready(wire);
            await lifetime;
          },
          async (method, params) => {
            // A fork never asks the person anything, and never through the turn.
            if (this.sides.has(threadOf(params))) {
              if (method.endsWith("requestApproval"))
                return { decision: "decline" };
              throw new Error(`A side check can't answer ${method}.`);
            }
            if (this.onRequest) return this.onRequest(method, params);
            if (method.endsWith("requestApproval"))
              return { decision: "decline" };
            throw new Error(`No active handler for ${method}.`);
          },
        );
      })
      .catch(fail);
  }

  /**
   * A goal turn no run shows, one Codex started after the run let go: it
   * stops, and the goal waits paused for /goal resume rather than working
   * where nobody sees it.
   */
  private unheard(method: string, params: unknown) {
    if (method !== "turn/started" || this.goal?.status !== "active") return;
    const threadId = threadOf(params);
    const turnId = (params as { turn?: { id?: unknown } })?.turn?.id;
    void this.ready
      .then(async (wire) => {
        await wire.request("thread/goal/set", { threadId, status: "paused" });
        if (typeof turnId === "string")
          await wire.request("turn/interrupt", { threadId, turnId });
      })
      .catch((e) => console.warn("Could not stop a Codex goal turn:", e));
  }

  /** Why a call failed: a process that died meanwhile says best, rather than the closed connection its calls saw. */
  failure(error: unknown) {
    return this.death ?? Promise.resolve(error);
  }

  /** Sends one thread's notifications and requests to `listen` until the returned function stops it. */
  side(threadId: string, listen: (method: string, params: any) => void) {
    this.sides.set(threadId, listen);
    return () => {
      this.sides.delete(threadId);
    };
  }

  /** The thread it started, kept with a hosted server for the next Relay. */
  keep(started: CodexThreadStarted) {
    this.started = started;
    if (this.child instanceof HostedChild)
      this.child.hosted.keep({
        provider: "codex",
        started,
        account: this.account,
      } satisfies CodexMeta);
  }

  /** Marks a turn in the host's log, so a restart knows one was running. */
  mark(mark: "start" | "end") {
    if (this.child instanceof HostedChild) this.child.hosted.mark(mark);
  }

  /** Lets through what a server picked up after a restart said meanwhile, once someone listens. */
  resume() {
    if (this.child instanceof HostedChild) this.child.release();
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.release();
      this.stop();
    }
    return this.done;
  }

  private stop() {
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    terminate(child);
  }
}

function threadOf(params: unknown) {
  const id = (params as { threadId?: unknown } | null)?.threadId;
  return typeof id === "string" ? id : "";
}

export type { CodexConnection };

const sessions = new HostedSessions<CodexConnection>({
  provider: "codex",
  name: "Codex",
  kind: "process",
  close: (connection) => connection.close(),
});

export async function acquireCodexConnection(
  key: string | undefined,
  executable: string,
  args: string[],
  cwd: string,
  account: { id: string; env: Record<string, string> },
) {
  // Another account needs an app server signed in as it; the thread resumes there.
  const live = key ? sessions.get(key) : undefined;
  if (live && !live.busy && (live.account ?? SYSTEM_ACCOUNT) !== account.id)
    await sessions.close(key!);
  // A thread's session runs in the host; helper jobs end with their turn.
  return sessions.acquire(key, async () => {
    const connection = new CodexConnection(() =>
      sessions.spawn(
        key,
        { provider: "codex", account: account.id } satisfies CodexMeta,
        {
          ...executableCommand(executable, args),
          cwd,
          env: account.env,
          group: false,
        },
        () =>
          spawnExecutable(executable, args, {
            cwd,
            env: account.env,
            stdio: ["pipe", "pipe", "pipe"],
          }) as ChildProcessWithoutNullStreams,
      ),
    );
    connection.account = account.id;
    return connection;
  });
}

export function closeCodexConnection(key: string) {
  return sessions.close(key);
}

/** Reads this session only, without starting another process or inference turn. */
export async function readCodexContext(key: string, usage: ContextUsage) {
  const connection = sessions.get(key);
  if (!connection?.started || connection.closed) return null;
  return estimateCodexContext(
    await connection.ready,
    connection.started.thread.id,
    usage,
    connection.threadSettings?.developerInstructions,
    connection.started.model ?? "",
  );
}

/** Relay is restarting: let go of the app servers the agent host keeps running. */
export function detachCodex() {
  sessions.detach();
}

/**
 * Takes back the app servers the agent host kept running while Relay
 * restarted. One that was in a turn waits, holding what it said meanwhile,
 * for an `adopt` turn to show it.
 */
export function reattachCodexSessions(owns: (key: string) => boolean) {
  return sessions.reattach(owns, (found) => {
    const { info } = found;
    const meta = savedMeta(found, codexMetaSchema);
    if (!meta?.started) return;
    const child = new HostedChild(found.attachProcess(), (entries) =>
      codexReplay(entries, info.split),
    );
    const connection = new CodexConnection(async () => child);
    connection.started = meta.started;
    connection.account = meta.account;
    if (!info.open) child.release();
    return connection;
  });
}

/**
 * What a turn cut off by a restart still has to hear: its notifications,
 * and the questions nobody answered. Replies to the last Relay's own
 * requests went to a transport that's gone.
 */
export function codexReplay(entries: Entry[], split: number): string[] {
  const answered = new Set<string>();
  for (const entry of entries)
    if (entry.kind === "input")
      try {
        const sent = JSON.parse(entry.text);
        if (sent?.id !== undefined && !("method" in sent))
          answered.add(String(sent.id));
      } catch {}
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== "line" || entry.seq < split) continue;
    let said: any;
    try {
      said = JSON.parse(entry.text);
    } catch {
      continue;
    }
    if (typeof said?.method !== "string") continue;
    if (said.id !== undefined && answered.has(String(said.id))) continue;
    lines.push(entry.text);
  }
  return lines;
}
