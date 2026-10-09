import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import type { WatchTokens } from "../../../../shared/watch";
import type { AgentWatch } from "../../types";
import type { CheckCost } from "../../watch/checks";
import {
  bareModel as bare,
  costAt,
  priceOf,
  promptOf,
  type Price,
} from "../../watch/prices";
import type { SDKMessage } from "../project/sdk";

/** The session's running totals, from Claude Code's `get_usage`. */
export type SessionTotals = {
  usd: number;
  models: Record<string, ModelUsage>;
};

type Usage = {
  input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number | null;
};

const none = (): WatchTokens => ({
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
});

/**
 * The session's own requests, main thread and subagents, as they finish.
 * A side check's window collects the ones that land in Claude Code's totals
 * beside it, so they can be taken back out.
 */
export class RequestTally {
  /** The request each stream (main, or a subagent's call) has open. */
  private open = new Map<string, { model: string; usage: Usage }>();
  private windows = new Set<{ model: string; tokens: WatchTokens }[]>();
  /** What the main thread runs on: the totals a check lands in. */
  mainModel?: string;
  /** The main thread writes the hour-long cache, as Claude Code does on a subscription. */
  longCache = true;

  observe(message: SDKMessage) {
    if (message.type !== "stream_event") return;
    const key = message.parent_tool_use_id ?? "main";
    const event = message.event;
    if (event.type === "message_start") {
      this.open.set(key, {
        model: event.message.model,
        usage: event.message.usage ?? {},
      });
      if (key === "main") {
        this.mainModel = event.message.model;
        const written = event.message.usage?.cache_creation;
        if (written?.ephemeral_5m_input_tokens) this.longCache = false;
        if (written?.ephemeral_1h_input_tokens) this.longCache = true;
      }
    }
    if (event.type === "message_delta") {
      const start = this.open.get(key);
      if (!start) return;
      this.open.delete(key);
      // The delta carries the request's final counts; older CLIs only its output.
      const usage = { ...start.usage, ...pickDefined(event.usage as Usage) };
      const done = { model: start.model, tokens: tokensOf(usage) };
      for (const window of this.windows) window.push(done);
    }
  }

  /** Collects what finishes until the returned function stops it. */
  collect() {
    const done: { model: string; tokens: WatchTokens }[] = [];
    this.windows.add(done);
    return () => {
      this.windows.delete(done);
      return done;
    };
  }
}

function pickDefined(usage: Usage): Usage {
  return Object.fromEntries(
    Object.entries(usage ?? {}).filter(([, v]) => typeof v === "number"),
  );
}

function tokensOf(u: Usage): WatchTokens {
  return {
    input: u.input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
  };
}

/** Other models: the usual shape of a price list, in units of plain input. */
const RATIO: Price = {
  input: 1,
  output: 5,
  cacheRead: 0.1,
  write5m: 1.25,
  write1h: 2,
};

/**
 * What one side check cost: how far the model's totals moved while it ran,
 * less the thread's own requests that finished meanwhile. With those in
 * the way the check's tokens are priced at list rates instead of read off
 * the totals. Claude Code's helper calls run on another model, so they stay
 * out. `longCache`: the session writes the hour-long cache, not the 5-minute one.
 */
export function checkSpend(
  before: SessionTotals,
  after: SessionTotals,
  others: { model: string; tokens: WatchTokens }[],
  mainModel?: string,
  longCache = true,
): (CheckCost & { usd: number }) | null {
  const moved = Object.keys(after.models).map((model) => {
    const a = after.models[model];
    const b = before.models[model];
    return {
      model,
      usd: a.costUSD - (b?.costUSD ?? 0),
      tokens: {
        input: a.inputTokens - (b?.inputTokens ?? 0),
        cacheWrite:
          a.cacheCreationInputTokens - (b?.cacheCreationInputTokens ?? 0),
        cacheRead: a.cacheReadInputTokens - (b?.cacheReadInputTokens ?? 0),
        output: a.outputTokens - (b?.outputTokens ?? 0),
      },
    };
  });
  // Without a main request seen yet, the check is the one that read the most context.
  const model = mainModel
    ? bare(mainModel)
    : moved
        .map((m) => ({ ...m, read: m.tokens.cacheRead + m.tokens.cacheWrite }))
        .sort((x, y) => y.read - x.read)
        .map((m) => bare(m.model))[0];
  if (!model) return null;
  const mine = moved.filter((m) => bare(m.model) === model);
  if (!mine.length) return null;
  const total = none();
  let usd = 0;
  for (const m of mine) {
    usd += m.usd;
    for (const k of Object.keys(total) as (keyof WatchTokens)[])
      total[k] += m.tokens[k];
  }
  const theirs = others.filter((o) => bare(o.model) === model);
  const tokens = { ...total };
  for (const o of theirs)
    for (const k of Object.keys(tokens) as (keyof WatchTokens)[])
      tokens[k] = Math.max(0, tokens[k] - o.tokens[k]);
  if (!Object.values(tokens).some((n) => n > 0)) return null;
  const split = theirs.length > 0;
  if (!split) return { model, tokens, usd: Math.max(0, usd), split };
  // The check's own tokens at list price; unknown models take their share of the dollars.
  const price = priceOf(model, { prompt: promptOf(tokens) });
  return {
    model,
    tokens,
    usd: price
      ? costAt(tokens, price, longCache)
      : usd *
        (costAt(tokens, RATIO, longCache) / costAt(total, RATIO, longCache)),
    split,
  };
}

/**
 * Measures the session's side checks against Claude Code's running totals,
 * and tells each watched turn what the whole session moved, checks included.
 */
export class ClaudeMeter {
  private tally = new RequestTally();
  /** The session's dollars at its last result; resumed sessions start with their old total. */
  private spent?: number;
  /** Results wait for the baseline, so a session's first watched turn counts too. */
  private ready: Promise<void>;

  constructor(private totals: () => Promise<SessionTotals>) {
    this.ready = totals().then(
      (t) => {
        this.spent ??= t.usd;
      },
      (e) =>
        console.warn(
          "Could not read where the Claude session's spend starts:",
          e,
        ),
    );
  }

  /** Every frame of the session; `watch` is the turn reading it, if watched. */
  observe(message: SDKMessage, watch?: AgentWatch) {
    this.tally.observe(message);
    if (message.type !== "result") return;
    const total = message.total_cost_usd;
    this.ready = this.ready.then(() => {
      if (this.spent !== undefined && total >= this.spent)
        watch?.onSpend?.({ kind: "thread", usd: total - this.spent });
      this.spent = total;
    });
  }

  /** Runs one side question, and what it cost when the totals answered on both sides. */
  async measure(ask: () => Promise<string | null>) {
    const before = await this.read();
    const stop = this.tally.collect();
    let reply: string | null;
    try {
      reply = await ask();
    } catch (error) {
      stop();
      throw error;
    }
    const after = before && (await this.read());
    if (!before || !after) {
      stop();
      return { reply };
    }
    // Frames trail the control replies a little; let the last requests land.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const cost = checkSpend(
      before,
      after,
      stop(),
      this.tally.mainModel,
      this.tally.longCache,
    );
    return { reply, ...(cost ? { cost } : {}) };
  }

  private read() {
    return this.totals().catch(() => null);
  }
}
