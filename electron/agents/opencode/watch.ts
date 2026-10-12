// "Flag what I'd miss" for OpenCode, done as for Codex: a throwaway fork of
// the thread's session with one turn of its own, asked with the thread's own
// agent, model and system prompt so it reads what the thread has cached.
import type { WatchTokens } from "../../../shared/watch";
import type { AgentOptions, AgentWatch } from "../types";
import { FORK_NOTE } from "../codex/codex-watch";
import { WatchChecks, type CheckCost } from "../watch/checks";
import { listCost } from "../watch/prices";
import { TurnWatcher } from "../watch/watcher";
import { openCode, subscribe, type OpenCodeEvent } from "./client";
import {
  messageListSchema,
  parseOpenCodeEvent,
  parseOpenCodePart,
  parseOpenCodeResponse,
  sessionCreatedSchema,
} from "./events";
import type { PermissionRule } from "./permissions";

/** What the thread's prompts carry; a check's must match, or it misses the cache. */
export type OpenCodePromptSettings = {
  agent: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  system: string;
};

/** Where a check forks from, read when it runs: the thread may have moved on. */
type WatchedSession = {
  id: string;
  directory: string;
  settings: OpenCodePromptSettings;
  /** The thread's rules, every tool asked for: the fork lists the same tools and runs none. */
  permission: PermissionRule[];
};

const LIMIT_MS = 120_000;

/**
 * One check: fork the session, ask, read the answer and what it used from
 * the fork's stored messages, then delete the fork. A fork that starts any
 * tool is stopped and its answer dropped; it may not act, as the thread or
 * otherwise.
 */
export async function askOpenCodeSide(
  session: WatchedSession,
  question: string,
  signal: AbortSignal,
): Promise<{ reply: string | null; cost?: CheckCost }> {
  signal.throwIfAborted();
  const { directory } = session;
  const call = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ) => openCode<unknown>(method, path, { directory, body });
  const fork = parseOpenCodeResponse(
    "forked session",
    sessionCreatedSchema,
    await call("POST", `/session/${session.id}/fork`, {}),
  ).id;
  let worked = false,
    busy = false,
    asked = Infinity;
  /** The fork's own replies; OpenCode also replays the thread's parts it copied. */
  const replies = new Set<string>();
  let settle!: () => void;
  const ended = new Promise<void>((resolve) => (settle = resolve));
  const stop = () =>
    call("POST", `/session/${fork}/abort`).then(
      () => {},
      () => {},
    );
  const listen = (raw: OpenCodeEvent) => {
    let event;
    try {
      event = parseOpenCodeEvent(raw);
    } catch {
      return settle();
    }
    if (!event) return;
    if (event.type === "message.updated") {
      const { info } = event.properties;
      if (info.role === "assistant" && (info.time?.created ?? 0) >= asked)
        replies.add(info.id);
    } else if (event.type === "message.part.updated") {
      if (!replies.has(event.properties.part.messageID)) return;
      const part = (() => {
        try {
          return parseOpenCodePart(event.properties.part);
        } catch {
          return undefined;
        }
      })();
      if (part?.type === "tool" && !worked) {
        worked = true;
        void stop().then(settle);
      }
    } else if (event.type === "permission.asked") {
      worked = true;
      void call("POST", `/permission/${event.properties.id}/reply`, {
        reply: "reject",
      }).catch(() => {});
      void stop().then(settle);
    } else if (event.type === "question.asked") {
      worked = true;
      void call("POST", `/question/${event.properties.id}/reject`, {}).catch(
        () => {},
      );
      void stop().then(settle);
    } else if (event.type === "session.status") {
      if (event.properties.status.type !== "idle") busy = true;
      else if (busy) settle();
    } else if (
      (event.type === "session.idle" && busy) ||
      event.type === "session.error" ||
      event.type === "relay.stream.lost"
    )
      settle();
  };
  const unsubscribe = await subscribe(fork, listen);
  const timer = setTimeout(() => void stop().then(settle), LIMIT_MS);
  const abort = () => void stop().then(settle);
  signal.addEventListener("abort", abort, { once: true });
  try {
    await call("PATCH", `/session/${fork}`, { permission: session.permission });
    busy = true;
    asked = Date.now();
    await call("POST", `/session/${fork}/prompt_async`, {
      ...session.settings,
      parts: [{ type: "text", text: `${FORK_NOTE}\n\n${question}` }],
    });
    await ended;
    const read = await readFork(call, fork);
    return worked || signal.aborted ? { ...read, reply: null } : read;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    unsubscribe();
    void call("DELETE", `/session/${fork}`).catch(() => {});
  }
}

/** The fork's answer to the one question, and what answering it cost. */
async function readFork(
  call: (method: "GET", path: string) => Promise<unknown>,
  fork: string,
): Promise<{ reply: string | null; cost?: CheckCost }> {
  const list = parseOpenCodeResponse(
    "session message list",
    messageListSchema,
    await call("GET", `/session/${fork}/message`),
  );
  let prompt = -1;
  list.forEach((m, i) => {
    if (m.info.role === "user") prompt = i;
  });
  const tokens: WatchTokens = {
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
  };
  let usd: number | undefined = 0,
    model = "",
    reply = "";
  for (const message of list.slice(prompt + 1)) {
    if (message.info.role !== "assistant") continue;
    if (message.info.providerID && message.info.modelID)
      model = `${message.info.providerID}/${message.info.modelID}`;
    for (const raw of message.parts ?? []) {
      const part = parseOpenCodePart(raw);
      if (part?.type === "text" && !part.synthetic && !part.ignored)
        reply += part.text ?? "";
      if (part?.type !== "step-finish" || !part.tokens) continue;
      const t = part.tokens;
      tokens.input += t.input ?? 0;
      tokens.cacheRead += t.cache?.read ?? 0;
      tokens.cacheWrite += t.cache?.write ?? 0;
      tokens.output += (t.output ?? 0) + (t.reasoning ?? 0);
      usd =
        usd !== undefined && typeof part.cost === "number"
          ? usd + part.cost
          : undefined;
    }
  }
  usd ??= listCost(model, tokens);
  const used = tokens.input + tokens.cacheRead + tokens.output > 0;
  return {
    reply: reply.trim() || null,
    ...(used && model
      ? { cost: { model, tokens, ...(usd === undefined ? {} : { usd }) } }
      : {}),
  };
}

/** A thread's checks, kept past its turns so one still running reports to its turn. */
class OpenCodeWatch {
  readonly checks: WatchChecks;
  watch?: AgentWatch;
  session?: WatchedSession;

  constructor() {
    this.checks = new WatchChecks(async (question, signal) => {
      if (!this.session) return { reply: null };
      const answer = await askOpenCodeSide(this.session, question, signal);
      // The thread's total holds its checks, as Claude's session totals do.
      if (answer.cost?.usd !== undefined)
        this.watch?.onSpend?.({ kind: "thread", usd: answer.cost.usd });
      return answer;
    });
  }
}

const watches = new Map<string, OpenCodeWatch>();

/** Lets go of a thread's checks, once its session is closed. */
export function forgetOpenCodeWatch(key: string) {
  watches.delete(key);
}

/** What a watched turn tells its thread's checks as OpenCode works. */
export type OpenCodeTurnWatch = {
  /** A call of the thread's own agent; repeats count once. */
  called(callID: string): void;
  /** One of the thread's own requests finished, costing `usd`. */
  requested(usd: number | null | undefined): void;
  /** The turn finished with `answer`. */
  ended(answer: string): void;
};

/** The turn's link to its thread's checks; none when the turn isn't watched. */
export function openCodeTurnWatcher(
  options: AgentOptions,
  session: WatchedSession,
): OpenCodeTurnWatch | undefined {
  if (!options.watch) return;
  const key = options.session?.key ?? session.id;
  let state = watches.get(key);
  if (!state) watches.set(key, (state = new OpenCodeWatch()));
  state.watch = options.watch;
  state.session = session;
  const turn = new TurnWatcher(options.watch, state.checks, options.signal);
  const watch = options.watch;
  return {
    called: (callID) => turn.called([callID]),
    requested: (usd) => {
      if (typeof usd === "number" && Number.isFinite(usd) && usd > 0)
        watch.onSpend?.({ kind: "thread", usd });
    },
    ended: (answer) => turn.ended(answer),
  };
}
