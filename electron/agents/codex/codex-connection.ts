import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { terminate } from "../../platform/terminate";
import { executableCommand, spawnExecutable } from "../../platform/executables";
import { withCodexTransport, type CodexTransport } from "./codex-transport";
import { HostedChild } from "../../agent-host/child";
import type { Entry } from "../../agent-host/protocol";
import { HostedSessions } from "../hosted-sessions";

/** What a hosted app server keeps for the next Relay: the thread it started. */
type CodexMeta = { provider: "codex"; started?: any };

/** A native session owns its approvals. Keep its process alive between project turns. */
class CodexConnection {
  child?: ChildProcessWithoutNullStreams | HostedChild;
  readonly ready: Promise<CodexTransport>;
  readonly done: Promise<void>;
  started?: any;
  busy = false;
  closed = false;
  onNotification?: (method: string, params: any) => void;
  onRequest?: (method: string, params: any) => Promise<unknown>;
  onError?: (error: Error) => void;
  private release!: () => void;
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
        child.on("exit", () =>
          fail(
            new Error(
              "Codex stopped before finishing. Check your local Codex sign-in.",
            ),
          ),
        );
        child.stdin.on("error", () =>
          fail(new Error("The Codex connection closed.")),
        );
        child.stderr.resume();
        return withCodexTransport(
          // Hosted or not, it reads and writes like the child it was.
          child as ChildProcessWithoutNullStreams,
          (method, params) => this.onNotification?.(method, params),
          fail,
          async (wire) => {
            ready(wire);
            await lifetime;
          },
          async (method, params) => {
            if (this.onRequest) return this.onRequest(method, params);
            if (method.endsWith("requestApproval"))
              return { decision: "decline" };
            throw new Error(`No active handler for ${method}.`);
          },
        );
      })
      .catch(fail);
  }
  /** The thread it started, kept with a hosted server for the next Relay. */
  keep(started: any) {
    this.started = started;
    if (this.child instanceof HostedChild)
      this.child.hosted.keep({
        provider: "codex",
        started,
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
const sessions = new HostedSessions<CodexConnection>({
  provider: "codex",
  name: "Codex",
  kind: "process",
  close: (connection) => connection.close(),
});
export function acquireCodexConnection(
  key: string | undefined,
  executable: string,
  args: string[],
  cwd: string,
) {
  // A thread's session runs in the host; rooms and helper jobs end with their turn.
  return sessions.acquire(
    key,
    async () =>
      new CodexConnection(() =>
        sessions.spawn(
          key,
          { provider: "codex" } satisfies CodexMeta,
          {
            ...executableCommand(executable, args),
            cwd,
            env: { ...process.env } as Record<string, string>,
            group: false,
          },
          () =>
            spawnExecutable(executable, args, {
              cwd,
              stdio: ["pipe", "pipe", "pipe"],
            }) as ChildProcessWithoutNullStreams,
        ),
      ),
  );
}
export function closeCodexConnection(key: string) {
  return sessions.close(key);
}

/**
 * Takes back the app servers the agent host kept running while Relay
 * restarted. One that was in a turn waits, holding what it said meanwhile,
 * for an `adopt` turn to show it.
 */
export function reattachCodexSessions(owns: (key: string) => boolean) {
  return sessions.reattach(owns, (found) => {
    const { info } = found;
    const meta = info.meta as CodexMeta;
    if (!meta.started) return;
    const child = new HostedChild(found.attachProcess(), (entries) =>
      codexReplay(entries, info.split),
    );
    const connection = new CodexConnection(async () => child);
    connection.started = meta.started;
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
