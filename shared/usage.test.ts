import { describe, expect, it } from "vitest";
import {
  modelLabel,
  summarizeUsage,
  type UsageEntry,
  type UsageJob,
  type UsageModelSpend,
} from "./usage";

// Tuesday, Oct 6 2026, noon local time.
const now = new Date(2026, 9, 6, 12).getTime();
const at = (day: number, hour = 12, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();
const spend = (
  input: number,
  output: number,
  usd?: number,
): UsageModelSpend => ({
  tokens: { input, cacheWrite: 0, cacheRead: 0, output },
  usd,
  requests: 1,
});
const run = (e: Partial<UsageEntry>): UsageEntry => ({
  at: now,
  ms: 0,
  provider: "claude",
  job: "thread",
  answer: true,
  models: {},
  ...e,
});
const summary = (
  entries: UsageEntry[],
  more: Partial<Parameters<typeof summarizeUsage>[1]> = {},
) => summarizeUsage(entries, { range: "7d", now, chats: [], ...more });

describe("summarizeUsage", () => {
  it("keeps the last seven days, bucketed by local day", () => {
    const s = summary([
      run({ at: at(6, 9), models: { "claude-opus-5-5": spend(100, 0, 1) } }),
      run({ at: at(1, 9), models: { "claude-opus-5-5": spend(1, 0) } }), // Oct 1
      run({
        at: at(5, 23, 59),
        provider: "codex",
        models: { "gpt-5": spend(50, 0, 0.5) },
      }),
      run({ at: at(-1, 9), models: { "claude-opus-5-5": spend(999, 0) } }), // Sep 29: outside
    ]);
    expect(s.days).toHaveLength(7);
    expect(s.days[0].day).toBe(at(0, 0)); // Sep 30
    expect(s.days.at(-1)!.tokens).toMatchObject({ claude: 100, codex: 0 });
    expect(s.days.at(-2)!.tokens).toMatchObject({ codex: 50 });
    expect(s.totals).toMatchObject({ tokens: 151, usd: 1.5, answers: 3 });
    expect(s.harnesses.map((h) => h.provider)).toEqual(["claude", "codex"]);
  });

  it("credits an answer to the model that did most of it and merges dated model ids", () => {
    const s = summary([
      run({
        models: {
          "claude-opus-5-5-20260901": spend(1000, 100, 2),
          "claude-haiku-4-5": spend(10, 1, 0.01),
        },
      }),
      run({ models: { "claude-opus-5-5": spend(10, 1, 0.1) } }),
    ]);
    const opus = s.models.find((m) => m.model === "Opus 5.5")!;
    expect(opus).toMatchObject({ tokens: 1111, answers: 2, unpriced: false });
    expect(s.models.find((m) => m.model === "Haiku 4.5")!.answers).toBe(0);
  });

  it("marks a model with unpriced tokens", () => {
    const s = summary([
      run({ provider: "opencode", models: { "x/y": spend(10, 0) } }),
    ]);
    expect(s.models[0]).toMatchObject({ model: "x/y", usd: 0, unpriced: true });
  });

  it("splits Relay's own jobs from threads and old room runs", () => {
    const s = summary([
      run({ chat: "c1", models: { m: spend(100, 0, 1) } }),
      // Logged before pull request rooms were removed.
      run({ job: "room" as UsageJob, models: { m: spend(40, 0, 0.4) } }),
      run({ job: "title", models: { m: spend(5, 0, 0.05) } }),
      run({ job: "title", models: { m: spend(5, 0, 0.05) } }),
      run({ job: "watch", answer: false, models: { m: spend(20, 0, 0.2) } }),
    ]);
    expect(s.totals.tokens).toBe(170);
    expect(s.totals.relayTokens).toBe(30);
    expect(s.totals.relayUsd).toBeCloseTo(0.3);
    expect(s.jobs.map((j) => [j.job, j.runs])).toEqual([
      ["watch", 1],
      ["title", 2],
    ]);
    expect(s.threads.map((t) => t.chat)).toEqual(["c1"]);
  });

  it("counts threads and what each used", () => {
    const s = summary(
      [
        run({ chat: "a", models: { m: spend(100, 0) } }),
        run({ chat: "a", models: { m: spend(100, 0) } }),
        run({ chat: "b", provider: "codex", models: { m: spend(50, 0) } }),
        run({ chat: "c", models: { m: spend(1000, 0) } }),
      ],
      {
        chats: [
          {
            id: "a",
            title: "Usage page",
            project: "relay",
            created: at(5),
            byAgent: false,
          },
          {
            id: "b",
            title: "Fix",
            project: "relay",
            created: at(6),
            byAgent: true,
            settledAt: at(6),
          },
          {
            id: "old",
            title: "Old",
            project: "relay",
            created: at(1, 0) - 30 * 86_400_000,
            byAgent: false,
          },
        ],
      },
    );
    expect(s.cards).toEqual({ started: 2, byAgents: 1, settled: 1 });
    expect(s.perThread.tokensAvg).toBeCloseTo(1250 / 3);
    expect(s.perThread.tokensMedian).toBe(200);
    expect(s.perThread.answersAvg).toBeCloseTo(4 / 3);
    expect(s.threads[0]).toMatchObject({ chat: "c", title: "Deleted thread" });
    expect(s.threads[1]).toMatchObject({
      chat: "a",
      title: "Usage page",
      project: "relay",
      answers: 2,
    });
    expect(s.threads[2].provider).toBe("codex");
  });

  it("spreads busy time over the hours a run covered", () => {
    // Monday Oct 5, 10:30 for an hour.
    const s = summary([
      run({ at: at(5, 10, 30), ms: 60 * 60_000, models: { m: spend(1, 0) } }),
    ]);
    expect(s.heat[0][10]).toBe(30);
    expect(s.heat[0][11]).toBe(30);
    expect(s.totals.agentMs).toBe(3_600_000);
  });

  it("reads five-hour windows and the weekly line from limit readings", () => {
    const reading = (
      hour: number,
      session: number | null,
      weekly: number | null,
    ) => ({
      at: at(6, hour),
      session,
      weekly,
    });
    const s = summary([run({ models: { m: spend(1, 0) } })], {
      now: at(6, 23),
      limits: {
        claude: [
          reading(1, 0, 10),
          reading(2, 30, 12),
          reading(3, 100, 15),
          reading(4, 100, 15),
          reading(7, 5, 15),
          reading(8, 40, 20),
        ],
        codex: [reading(5, 50, 60)],
      },
    });
    expect(s.windows).toEqual({ opened: 3, ranOut: 1 });
    expect(s.weekly.map((p) => [p.claude, p.codex])).toEqual([
      [10, null],
      [12, null],
      [15, null],
      [15, null],
      [15, 60],
      [15, 60],
      [20, 60],
    ]);
  });

  it("starts All at the first thing counted", () => {
    const s = summary([run({ at: at(2, 9), models: { m: spend(1, 0) } })], {
      range: "all",
    });
    expect(s.since).toBe(at(2, 9));
    expect(s.days[0].day).toBe(at(2, 0));
    expect(s.days).toHaveLength(5);
  });

  it("has nothing to say before anything was counted", () => {
    const s = summary([]);
    expect(s.since).toBeUndefined();
    expect(s.totals.tokens).toBe(0);
    expect(s.days).toHaveLength(7);
  });
});

describe("modelLabel", () => {
  it("names Claude models the way people say them", () => {
    expect(modelLabel("claude-opus-5-5-20260901[1m]")).toBe("Opus 5.5");
    expect(modelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelLabel("claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelLabel("gpt-5.1-codex")).toBe("gpt-5.1-codex");
  });
});
