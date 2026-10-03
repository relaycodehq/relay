// What the agent host runs: a Claude SDK session, or a plain process such as
// Codex's app server. Each keeps a log of what it said, and of the turns Relay
// marked in it, so a Relay that comes back can pick up where it left off.
import { spawn, type ChildProcess } from "node:child_process";
import {
  query,
  type HookCallbackMatcher,
  type HookEvent,
  type Options,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  queryMethods,
  type AskName,
  type Asks,
  type Entry,
  type HookMode,
  type LogEntry,
  type ProcessSpec,
  type SessionInfo,
} from "./protocol";
import { AsyncQueue } from "../util/async-queue";
import { terminate } from "../platform/terminate";

/** Log sizes: past this, what a restart can't need goes first. */
const limits = { entries: 30_000, line: 8 << 20 };

/** What sessions need from the host around them. */
export interface SessionHost {
  /** Hands Relay an entry, if it's reading this session. */
  deliver(session: HostSession, entry: Entry): void;
  ask<N extends AskName>(
    session: HostSession,
    name: N,
    args: Asks[N]["args"],
    options: {
      signal?: AbortSignal;
      timeout?: number;
      fallback: Asks[N]["answer"];
    },
  ): Promise<Asks[N]["answer"]>;
  /** Whether a question it asked still waits for Relay. */
  asking(session: HostSession): boolean;
}

export abstract class HostSession {
  abstract readonly kind: "claude" | "process";
  entries: Entry[] = [];
  seq = 0;
  ended = false;
  /** The client reads this session's entries as they come. */
  attached = false;
  threadId?: string;
  tasks = 0;
  wakeups = 0;
  open = false;
  start = 0;
  end = 0;
  /** Named turns in flight, by where each began. */
  turns = new Map<string, number>();
  constructor(
    readonly id: string,
    readonly key: string,
    public meta: unknown,
    protected host: SessionHost,
  ) {}

  abstract push(message: unknown): void;
  abstract abort(): void;
  abstract close(): void;
  abstract call(method: string, args: unknown[]): Promise<unknown>;

  info(): SessionInfo {
    return {
      id: this.id,
      key: this.key,
      kind: this.kind,
      meta: this.meta,
      ...(this.threadId ? { threadId: this.threadId } : {}),
      split: this.open ? this.start : this.end,
      open: this.open,
      ...(this.ended ? { ended: true } : {}),
      turns: Object.fromEntries(this.turns),
    };
  }

  append(entry: LogEntry) {
    const logged = { ...entry, seq: this.seq++ } as Entry;
    this.entries.push(logged);
    this.observe(logged);
    this.host.deliver(this, logged);
    if (logged.kind === "mark" && logged.mark === "end" && !logged.turn)
      this.compact();
    else if (this.entries.length > limits.entries) this.trim();
  }

  mark(mark: "start" | "end", at = this.seq, turn?: string) {
    this.append({ kind: "mark", mark, at, ...(turn ? { turn } : {}) });
  }

  protected observe(entry: Entry) {
    if (entry.kind === "mark") {
      if (entry.turn) {
        if (entry.mark === "start") this.turns.set(entry.turn, entry.at);
        else this.turns.delete(entry.turn);
        return;
      }
      this.open = entry.mark === "start";
      if (this.open) this.start = entry.at;
      else this.end = entry.at;
    } else if (entry.kind === "end") this.ended = true;
  }

  /** What a restart still needs once a turn has ended; everything, by default. */
  protected kept(): Entry[] {
    return [];
  }

  /**
   * A finished turn with no background work leaves nothing to rebuild but
   * what `kept` names; running work keeps its whole story.
   */
  private compact() {
    if (this.tasks > 0) return this.trim();
    const kept = new Set(this.kept());
    this.entries = this.entries.filter((e) => e.seq >= this.end || kept.has(e));
  }

  /** Streamed deltas of finished turns go first: the assistant frames repeat them. */
  private trim() {
    if (this.entries.length <= limits.entries) return;
    const split = this.open ? this.start : this.end;
    this.entries = this.entries.filter(
      (e) =>
        e.seq >= split ||
        e.kind !== "frame" ||
        (e.message as { type?: string }).type !== "stream_event",
    );
    if (this.entries.length > limits.entries)
      this.entries.splice(0, this.entries.length - limits.entries);
  }

  /** Something that still needs Relay: a turn, background work or a question. */
  working() {
    if (this.ended) return false;
    return (
      this.open ||
      this.turns.size > 0 ||
      this.tasks > 0 ||
      this.wakeups > 0 ||
      this.host.asking(this)
    );
  }
}

export class ClaudeSession extends HostSession {
  readonly kind = "claude";
  private input = new AsyncQueue<SDKUserMessage>();
  private controller = new AbortController();
  private query!: Query;

  launch(
    options: Record<string, unknown>,
    hooks: Record<string, HookMode>,
    asks: { canUseTool: boolean; onElicitation: boolean },
  ) {
    const matchers: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
    for (const [event, mode] of Object.entries(hooks) as [
      HookEvent,
      HookMode,
    ][])
      matchers[event] = [
        {
          hooks: [
            async (input) => {
              if (mode === "record") {
                this.append({ kind: "hook", event, input });
                return {};
              }
              // The answer is JSON off the socket; the SDK needs an object.
              return (
                (await this.host.ask(this, "hook", [event, input], {
                  timeout: mode.timeout,
                  fallback: {},
                })) ?? {}
              );
            },
          ],
        },
      ];
    this.query = query({
      prompt: this.input,
      options: {
        ...(options as Options),
        abortController: this.controller,
        hooks: matchers,
        ...(asks.canUseTool
          ? {
              canUseTool: (tool, input, { signal, ...context }) =>
                this.host.ask(this, "canUseTool", [tool, input, context], {
                  signal,
                  fallback: { behavior: "deny", message: "Cancelled." },
                }),
            }
          : {}),
        ...(asks.onElicitation
          ? {
              onElicitation: (request, { signal, ...context }) =>
                this.host.ask(this, "onElicitation", [request, context], {
                  signal,
                  fallback: { action: "cancel" },
                }),
            }
          : {}),
      },
    });
    void (async () => {
      let failure: string | undefined;
      try {
        for await (const frame of this.query)
          this.append({ kind: "frame", message: frame });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      this.append({ kind: "end", ...(failure ? { failure } : {}) });
    })();
  }

  protected observe(entry: Entry) {
    super.observe(entry);
    if (entry.kind === "frame") {
      const frame = entry.message as {
        type?: string;
        subtype?: string;
        session_id?: string;
        tasks?: { ambient?: boolean }[];
      };
      if (frame.session_id) this.threadId = frame.session_id;
      if (
        frame.type === "system" &&
        frame.subtype === "background_tasks_changed"
      )
        this.tasks = (frame.tasks ?? []).filter((t) => !t.ambient).length;
    } else if (entry.kind === "hook" && entry.event === "Stop") {
      const input = entry.input as { session_crons?: unknown[] };
      this.wakeups = input?.session_crons?.length ?? 0;
    }
  }

  /** The latest task list and wake-ups, which the next Relay rebuilds from. */
  protected kept() {
    const latest = (test: (e: Entry) => boolean) => {
      for (let i = this.entries.length - 1; i >= 0; i--)
        if (this.entries[i].seq < this.end && test(this.entries[i]))
          return [this.entries[i]];
      return [];
    };
    return [
      ...latest(
        (e) =>
          e.kind === "frame" &&
          (e.message as { subtype?: string }).subtype ===
            "background_tasks_changed",
      ),
      ...latest((e) => e.kind === "hook" && e.event === "Stop"),
    ];
  }

  push(message: unknown) {
    this.input.push(message as SDKUserMessage);
  }

  abort() {
    this.controller.abort();
  }

  close() {
    this.input.close();
    try {
      this.query?.close();
    } catch {}
  }

  async call(method: string, args: unknown[]) {
    if (this.ended) throw new Error("The session has ended.");
    if (!(queryMethods as readonly string[]).includes(method))
      throw new Error(`Unknown session call: ${method}.`);
    const run = (this.query as unknown as Record<string, unknown>)[method];
    if (typeof run !== "function")
      throw new Error(`This Claude Code has no ${method}.`);
    return run.apply(this.query, args);
  }
}

/** A command whose output lines are the log and whose input Relay writes. */
export class ProcessSession extends HostSession {
  readonly kind = "process";
  private child?: ChildProcess;
  private closing = false;
  private group = false;
  private stopByInput = false;

  launch(spec: ProcessSpec) {
    this.group = spec.group && process.platform !== "win32";
    this.stopByInput = !!spec.stopByInput;
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: this.group,
    });
    this.child = child;
    let buffer = "",
      errors = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        this.append({ kind: "line", text: buffer.slice(0, at) });
        buffer = buffer.slice(at + 1);
      }
      // A line this long is broken output; the reader would refuse it anyway.
      if (buffer.length > limits.line) buffer = "";
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      errors = (errors + chunk).slice(-4000);
    });
    child.stdin!.on("error", () => {});
    const ended = (failure?: string) => {
      if (this.ended) return;
      this.append({
        kind: "end",
        ...(failure && !this.closing ? { failure } : {}),
      });
    };
    child.once("error", (error) => ended(error.message));
    child.once("exit", (code, signal) =>
      ended(
        `${spec.command.split(/[\\/]/).pop()} exited (${signal ?? code}).${errors.trim() ? ` ${errors.trim().slice(-500)}` : ""}`,
      ),
    );
  }

  push(message: unknown) {
    if (typeof message !== "string" || this.ended || !this.child) return;
    this.append({ kind: "input", text: message });
    this.child.stdin!.write(message + "\n");
  }

  abort() {
    this.close();
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    const child = this.child;
    if (!child) return;
    child.stdin?.end();
    terminate(child, {
      graceMs: 3000,
      group: this.group,
      byInput: this.stopByInput,
    });
  }

  async call(): Promise<unknown> {
    throw new Error("A process session takes no calls.");
  }
}
