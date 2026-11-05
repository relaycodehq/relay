// A Claude session the agent host runs for Relay, as Relay reads and drives it.
import type { AskMessage, Asks, Entry, HookFrame } from "./protocol";
import { AsyncQueue } from "../util/async-queue";
import { errorMessage } from "../../shared/error-message";
import type { ProcessLink } from "./hosted-process";

/**
 * How long a session's control call may take. Claude Code answers them at
 * once, even mid-turn, so a slower one met a stuck host or CLI. 20 seconds is
 * what Relay already gives a freshly started CLI to answer the same requests
 * when it lists models and commands.
 */
const callLimit = 20_000;

/** A question's arguments, its last one carrying the signal that withdraws it. */
type WithSignal<T extends unknown[]> = T extends [...infer Head, infer Context]
  ? [...Head, context: Context & { signal: AbortSignal }]
  : never;

/** What the host asks of Relay while a session runs. */
export interface HostedHandlers {
  canUseTool?: (
    ...args: WithSignal<Asks["canUseTool"]["args"]>
  ) => Promise<Asks["canUseTool"]["answer"]>;
  onElicitation?: (
    ...args: WithSignal<Asks["onElicitation"]["args"]>
  ) => Promise<Asks["onElicitation"]["answer"]>;
  hooks: Record<string, (input: unknown) => Promise<unknown>>;
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
    private connection: ProcessLink,
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

  ask(message: AskMessage) {
    const controller = new AbortController();
    this.asking.set(message.id, controller);
    const run = async () => {
      if (message.name === "canUseTool") {
        const [tool, input, context] = message.args;
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
        const [request, context] = message.args;
        return this.handlers.onElicitation(request, {
          ...context,
          signal: controller.signal,
        });
      }
      const [event, input] = message.args;
      return (await this.handlers.hooks[event]?.(input)) ?? {};
    };
    void run().then(
      (value) => this.answer(message.id, { value }),
      (error) =>
        this.answer(message.id, {
          error: errorMessage(error),
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
