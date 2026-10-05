// "Flag what I'd miss" for Codex, done the way Codex's own `/side` is: a
// throwaway fork of the live thread with one turn of its own. The fork must
// carry exactly the settings the thread was started with, or it reads none
// of the thread's cache (measured: 41% cached bare, 98% with them).
import type { WatchTokens } from "../../../shared/watch";
import type { AgentOptions, AgentWatch } from "../types";
import { WatchChecks, type CheckCost } from "../watch/checks";
import { listCost } from "../watch/prices";
import { TurnWatcher } from "../watch/watcher";
import type { CodexConnection } from "./codex-connection";
import type { CodexTransport } from "./codex-transport";

type Usage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
};

/** Codex counts cached input inside `inputTokens`; Relay bills them apart. */
export function codexTokens(u: Usage): WatchTokens {
  const cacheRead = u.cachedInputTokens ?? 0;
  const cacheWrite = u.cacheWriteInputTokens ?? 0;
  return {
    input: Math.max(0, (u.inputTokens ?? 0) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: u.outputTokens ?? 0,
  };
}

const add = (a: WatchTokens, b: WatchTokens): WatchTokens => ({
  input: a.input + b.input,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
});

/** What the check needs of the app server the thread runs on. */
export type CodexSideWire = {
  request(method: string, params: unknown): Promise<any>;
  /** Sends one thread's notifications to `listen`, and answers its requests with no; returns the way to stop. */
  side(
    threadId: string,
    listen: (method: string, params: any) => void,
  ): () => void;
};

/** Items that mean the fork went to work instead of answering. */
const TOOLS = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  "webSearch",
  "imageGeneration",
]);
const LIMIT_MS = 120_000;

/** A fork taken mid-call sees that call cut off; the thread itself is still running it. */
export const FORK_NOTE = `You are reading a copy of this thread taken while it was still working. Its last tool call may show here as aborted, interrupted or without output, even though it is still running in the main thread. That is how the copy was taken, not a failure: never mention it or flag it.`;

/**
 * One check: fork the thread, ask, read the answer and what the fork's
 * requests used. A fork that starts any tool is stopped and its answer
 * dropped; it may not act, as the thread or otherwise.
 */
export async function askCodexSide(
  wire: CodexSideWire,
  threadId: string,
  settings: Record<string, unknown>,
  question: string,
  signal: AbortSignal,
): Promise<{ reply: string | null; cost?: CheckCost }> {
  signal.throwIfAborted();
  const fork = (await wire.request("thread/fork", {
    ...settings,
    threadId,
    ephemeral: true,
    excludeTurns: true,
  })) as { thread: { id: string }; model?: string };
  const forkId = fork.thread.id;
  let reply = "";
  let tokens: WatchTokens = {
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
  };
  let turnId = "";
  let worked = false;
  let settle!: () => void;
  const ended = new Promise<void>((resolve) => (settle = resolve));
  const stopListening = wire.side(forkId, (method, params) => {
    if (method === "thread/tokenUsage/updated")
      tokens = add(tokens, codexTokens(params?.tokenUsage?.last ?? {}));
    if (method === "turn/started") turnId = params?.turn?.id ?? turnId;
    const item = params?.item;
    if (method === "item/started" && TOOLS.has(item?.type) && !worked) {
      worked = true;
      void stop();
    }
    if (method === "item/completed" && item?.type === "agentMessage")
      reply += item.text ?? "";
    if (method === "turn/completed" || method === "error") settle();
  });
  const stop = () =>
    turnId
      ? wire
          .request("turn/interrupt", { threadId: forkId, turnId })
          .catch(() => {})
      : Promise.resolve();
  const timer = setTimeout(() => void stop().then(settle), LIMIT_MS);
  const abort = () => void stop().then(settle);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const started = (await wire.request("turn/start", {
      threadId: forkId,
      input: [
        {
          type: "text",
          text: `${FORK_NOTE}\n\n${question}`,
          text_elements: [],
        },
      ],
      // Never asks, writes nothing; neither changes what the cache holds.
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    })) as { turn?: { id?: string } };
    turnId ||= started.turn?.id ?? "";
    if (worked) await stop();
    await ended;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    stopListening();
    void wire
      .request("thread/unsubscribe", { threadId: forkId })
      .catch(() => {});
  }
  const model = fork.model ?? "";
  const usd = listCost(model, tokens);
  const used = tokens.input + tokens.cacheRead + tokens.output > 0;
  return {
    reply: worked || signal.aborted ? null : reply.trim() || null,
    ...(used && model
      ? { cost: { model, tokens, ...(usd === undefined ? {} : { usd }) } }
      : {}),
  };
}

/**
 * A Codex thread's side checks, kept with its app server so they outlive a
 * turn, and the turn being watched, so the thread's own requests count
 * towards its share.
 */
export class CodexWatch {
  readonly checks: WatchChecks;
  watch?: AgentWatch;

  constructor(
    wire: CodexSideWire,
    thread: () => { id: string; settings?: Record<string, unknown> },
  ) {
    this.checks = new WatchChecks(async (question, signal) => {
      const { id, settings } = thread();
      if (!id || !settings) return { reply: null };
      const answer = await askCodexSide(wire, id, settings, question, signal);
      // The thread's total holds its checks, as Claude's session totals do.
      if (answer.cost?.usd !== undefined)
        this.watch?.onSpend?.({ kind: "thread", usd: answer.cost.usd });
      return answer;
    });
  }

  /** One of the thread's own requests finished, on `model`. */
  requested(model: string, usage: Usage) {
    const usd = listCost(model, codexTokens(usage));
    if (usd !== undefined) this.watch?.onSpend?.({ kind: "thread", usd });
  }
}

/** What a watched turn tells its thread's watch as Codex works. */
export type CodexTurnWatch = {
  /** A finished item of the thread's own. */
  item(item: { id?: string | null; type?: string }): void;
  /** The thread's `thread/tokenUsage/updated`. */
  requested(tokenUsage: unknown): void;
  /** The turn completed with `answer`. */
  ended(answer: string): void;
};

/** The turn's link to its thread's checks; none when the turn isn't watched. */
export function codexTurnWatcher(
  connection: CodexConnection,
  transport: CodexTransport,
  options: AgentOptions,
): CodexTurnWatch | undefined {
  if (!options.watch) return undefined;
  const state = (connection.watch ??= new CodexWatch(
    {
      request: (method, params) => transport.request(method, params),
      side: (threadId, listen) => connection.side(threadId, listen),
    },
    () => ({
      id: connection.started?.thread.id ?? "",
      settings: connection.threadSettings,
    }),
  ));
  // Kept past the turn: a check still running reports to the turn it came from.
  state.watch = options.watch;
  const turn = new TurnWatcher(options.watch, state.checks, options.signal);
  return {
    item: (item) => {
      if (item.id && item.type && TOOLS.has(item.type)) turn.called([item.id]);
    },
    ended: (answer) => turn.ended(answer),
    requested: (tokenUsage) => {
      const last = (tokenUsage as { last?: Usage } | null)?.last;
      const model = options.choice.model || connection.started?.model || "";
      if (last && model) state.requested(model, last);
    },
  };
}
