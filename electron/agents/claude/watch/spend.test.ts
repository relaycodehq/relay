import { describe, expect, it } from "vitest";
import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import type { WatchSpend } from "../../../../shared/watch";
import {
  checkSpend,
  ClaudeMeter,
  RequestTally,
  type SessionTotals,
} from "./spend";
import type { SDKMessage } from "../project/sdk";

const usage = (
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  costUSD: number,
) =>
  ({
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheWrite,
    costUSD,
  }) as ModelUsage;

const totals = (models: Record<string, ModelUsage>): SessionTotals => ({
  usd: Object.values(models).reduce((sum, m) => sum + m.costUSD, 0),
  models,
});

const frame = (event: unknown, parent: string | null = null) =>
  ({
    type: "stream_event",
    parent_tool_use_id: parent,
    event,
  }) as unknown as SDKMessage;

// A Haiku side check asked while the main thread finished a request, as
// Claude Code reported it on a live run (2026-10-05).
const HAIKU = "claude-haiku-4-5-20251001";
const before = totals({ [HAIKU]: usage(953, 232, 11410, 3288, 0.00983) });
const after = totals({ [HAIKU]: usage(2185, 492, 40806, 4654, 0.01786185) });
const mainRequest = {
  model: HAIKU,
  tokens: { input: 8, output: 103, cacheRead: 14698, cacheWrite: 1137 },
};

describe("checkSpend", () => {
  it("is the totals' move when nothing else ran", () => {
    const spent = checkSpend(before, after, [], HAIKU);
    expect(spent?.split).toBe(false);
    expect(spent?.usd).toBeCloseTo(0.00803185, 8);
    expect(spent?.tokens.cacheRead).toBe(29396);
  });

  it("takes out the thread's own request and prices what's left", () => {
    const spent = checkSpend(before, after, [mainRequest], HAIKU, true);
    expect(spent?.split).toBe(true);
    expect(spent?.tokens).toEqual({
      input: 1224,
      output: 157,
      cacheRead: 14698,
      cacheWrite: 229,
    });
    // $1 in, $5 out, $0.10 read, $2 for an hour-long write, per million.
    expect(spent?.usd).toBeCloseTo(
      (1224 * 1 + 157 * 5 + 14698 * 0.1 + 229 * 2) / 1e6,
      10,
    );
  });

  it("leaves Claude Code's helper calls on other models out", () => {
    const opus = "claude-opus-5-5";
    const spent = checkSpend(
      totals({
        [opus]: usage(10, 100, 50_000, 0, 0.0124),
        [HAIKU]: usage(900, 20, 0, 0, 0.001),
      }),
      totals({
        [opus]: usage(400, 250, 100_000, 50, 0.02814),
        [HAIKU]: usage(1800, 40, 0, 0, 0.002),
      }),
      [],
      "claude-opus-5-5[1m]",
    );
    expect(spent?.model).toBe(opus);
    expect(spent?.usd).toBeCloseTo(0.01574, 8);
  });
});

describe("RequestTally", () => {
  it("collects requests that finish inside the window, subagents included", () => {
    const tally = new RequestTally();
    const start = (model: string, parent: string | null = null) =>
      tally.observe(
        frame(
          {
            type: "message_start",
            message: {
              model,
              usage: {
                input_tokens: 8,
                cache_read_input_tokens: 14698,
                cache_creation_input_tokens: 1137,
                cache_creation: { ephemeral_5m_input_tokens: 1137 },
                output_tokens: 1,
              },
            },
          },
          parent,
        ),
      );
    const end = (output: number, parent: string | null = null) =>
      tally.observe(
        frame(
          { type: "message_delta", usage: { output_tokens: output } },
          parent,
        ),
      );
    start(HAIKU);
    end(50);
    const stop = tally.collect();
    start(HAIKU);
    start(HAIKU, "agent-1");
    end(103);
    end(7, "agent-1");
    const done = stop();
    start(HAIKU);
    end(9);
    expect(done.map((d) => d.tokens.output)).toEqual([103, 7]);
    expect(done[0].tokens.cacheRead).toBe(14698);
    expect(tally.mainModel).toBe(HAIKU);
    expect(tally.longCache).toBe(false);
  });
});

describe("ClaudeMeter", () => {
  it("prices a check and tells each watched turn what the session moved", async () => {
    const model = "claude-opus-5-5";
    const at = (usd: number, read: number) =>
      totals({ [model]: usage(0, 0, read, 0, usd) });
    const readings = [at(1, 0), at(1, 0), at(1.02, 100_000)];
    const meter = new ClaudeMeter(async () => readings.shift()!);
    await Promise.resolve();
    const { reply, cost } = await meter.measure(async () => "learn: none");
    expect(reply).toBe("learn: none");
    expect(cost?.usd).toBeCloseTo(0.02, 10);
    expect(cost?.split).toBe(false);
    const spent: WatchSpend[] = [];
    meter.observe(
      { type: "result", total_cost_usd: 1.5 } as unknown as SDKMessage,
      {
        scope: "main",
        known: [],
        onNote: () => {},
        onSpend: (s) => spent.push(s),
      },
    );
    expect(spent).toEqual([{ kind: "thread", usd: 0.5 }]);
  });
});
