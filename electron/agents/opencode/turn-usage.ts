import type { z } from "zod";
import type { AgentOptions } from "../types";
import type { ContextUsage } from "../../../shared/projects";
import type { Streamed } from "../../../shared/usage";
import type { messageListSchema } from "./events";
import type { StepFinish } from "./subagents";
import { OpenCodeRequestSpeed } from "./speed";

type Hooks = Pick<AgentOptions, "onContext" | "onCost" | "onUsage">;

/** What a turn's requests cost and how full they left the context window. */
export class OpenCodeTurnUsage {
  context: ContextUsage | undefined;
  readonly speed = new OpenCodeRequestSpeed();
  /** Each finished step's cost, so a repeated update only adds what changed. */
  private stepCosts = new Map<string, number>();
  /** Each step's tokens once, the first time OpenCode reports them finished. */
  private counted = new Set<string>();

  constructor(
    private readonly hooks: Hooks,
    /** The context window of the model a step ran on, when the catalog knows it. */
    private readonly window: () => number | undefined,
    /** Every change in what the turn has cost. */
    private readonly spent: (usd: number) => void,
  ) {}

  /** The turn's own step finished; `live` when it happened now, not replayed. */
  step(part: StepFinish, model: string, live: boolean) {
    this.report(part.tokens);
    this.charge(part);
    const streamed = this.speed.finish(part.messageID, part.tokens);
    this.count(part, model, live ? streamed : undefined);
  }

  /** A subagent's step finished: it costs the turn, but fills no window of its own. */
  subagentStep(
    part: StepFinish,
    model: string,
    streamed: Streamed | undefined,
  ) {
    this.charge(part);
    this.count(part, model, streamed, true);
  }

  /** What the whole session has processed, as Claude and Codex report it. */
  sessionTotal(list: z.infer<typeof messageListSchema>) {
    // Each request is a message of its own.
    const total = list.reduce((sum, m) => {
      const t = m.info.role === "assistant" ? m.info.tokens : undefined;
      return t
        ? sum +
            (t.input ?? 0) +
            (t.output ?? 0) +
            (t.reasoning ?? 0) +
            (t.cache?.read ?? 0) +
            (t.cache?.write ?? 0)
        : sum;
    }, 0);
    if (this.context && total > this.context.usedTokens) {
      this.context = { ...this.context, totalTokens: total };
      this.hooks.onContext?.(this.context);
    }
  }

  private report(tokens: StepFinish["tokens"]) {
    if (!tokens) return;
    const { cache } = tokens;
    const used =
      tokens.total && tokens.total > 0
        ? tokens.total
        : [
            tokens.input,
            tokens.output,
            tokens.reasoning,
            cache?.read,
            cache?.write,
          ].reduce((a: number, b) => a + (b ?? 0), 0);
    if (!used) return;
    const max = this.window();
    this.context = { usedTokens: used, ...(max ? { maxTokens: max } : {}) };
    this.hooks.onContext?.(this.context);
  }

  private charge(part: { id: string; cost?: number | null }) {
    if (typeof part.cost !== "number" || !Number.isFinite(part.cost)) return;
    const delta = part.cost - (this.stepCosts.get(part.id) ?? 0);
    this.stepCosts.set(part.id, part.cost);
    if (delta) {
      this.hooks.onCost?.(delta);
      this.spent(delta);
    }
  }

  private count(
    part: StepFinish,
    model: string,
    streamed: Streamed | undefined,
    subagent = false,
  ) {
    const t = part.tokens;
    if (!t || this.counted.has(part.id)) return;
    this.counted.add(part.id);
    this.hooks.onUsage?.({
      model: model || "opencode",
      tokens: {
        input: t.input ?? 0,
        cacheWrite: t.cache?.write ?? 0,
        cacheRead: t.cache?.read ?? 0,
        output: (t.output ?? 0) + (t.reasoning ?? 0),
      },
      ...(typeof part.cost === "number" && Number.isFinite(part.cost)
        ? { usd: part.cost }
        : {}),
      ...(streamed ? { streamed } : {}),
      ...(subagent ? { subagent: true } : {}),
    });
  }
}
