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
    expect(s.days.at(-1)!.fresh).toMatchObject({ claude: 100, codex: 0 });
    expect(s.days.at(-2)!.usd).toMatchObject({ codex: 0.5 });
    expect(s.totals).toMatchObject({ fresh: 151, usd: 1.5, answers: 3 });
  });

  it("starts the days at the first one counted", () => {
    const s = summary([run({ at: at(4, 9), models: { m: spend(1, 0) } })]);
    expect(s.days.map((d) => d.day)).toEqual([at(4, 0), at(5, 0), at(6, 0)]);
  });

  it("counts cache re-reads in tokens but not in fresh tokens", () => {
    const s = summary([
      run({
        models: {
          m: {
            tokens: { input: 10, cacheWrite: 20, cacheRead: 900, output: 5 },
            requests: 1,
          },
        },
      }),
    ]);
    expect(s.totals).toMatchObject({ tokens: 935, fresh: 35 });
    expect(s.models[0].fresh).toBe(35);
  });

  it("merges dated model ids and marks unpriced ones", () => {
    const s = summary([
      run({ models: { "claude-opus-5-5-20260901": spend(1000, 100, 2) } }),
      run({ models: { "claude-opus-5-5": spend(10, 1, 0.1) } }),
      run({ provider: "opencode", models: { "x/y": spend(10, 0) } }),
    ]);
    expect(s.models.find((m) => m.model === "Opus 5.5")).toMatchObject({
      fresh: 1111,
      unpriced: false,
    });
    expect(s.models.find((m) => m.model === "x/y")).toMatchObject({
      usd: 0,
      unpriced: true,
    });
    expect(s.totals.unpriced).toBe(true);
  });

  it("splits Relay's own jobs from threads and old room runs", () => {
    const s = summary([
      run({ chat: "c1", models: { m: spend(100, 0, 1) } }),
      // Logged before pull request rooms were removed.
      run({ job: "room" as UsageJob, models: { m: spend(40, 0, 0.4) } }),
      run({ job: "title", models: { m: spend(5, 0, 0.05) } }),
      run({ job: "watch", answer: false, models: { m: spend(20, 0, 0.2) } }),
    ]);
    expect(s.totals.fresh).toBe(165);
    expect(s.totals.relayFresh).toBe(25);
    expect(s.totals.relayUsd).toBeCloseTo(0.25);
    expect(s.threads.map((t) => t.chat)).toEqual(["c1"]);
  });

  it("keeps the busiest threads by either measure, named from the chats", () => {
    const s = summary(
      [
        // Cheap but huge, then three pricier small ones.
        run({ chat: "big", models: { m: spend(10_000, 0, 0.01) } }),
        run({ chat: "a", models: { m: spend(30, 0, 3) } }),
        run({ chat: "b", provider: "codex", models: { m: spend(20, 0, 2) } }),
        run({ chat: "c", models: { m: spend(10, 0, 1) } }),
        run({ chat: "d", models: { m: spend(5, 0, 0) } }),
      ],
      {
        chats: [
          { id: "a", title: "Usage page", projectId: "p", project: "relay" },
        ],
      },
    );
    expect(s.threads.map((t) => t.chat).sort()).toEqual(["a", "b", "big", "c"]);
    expect(s.threads.find((t) => t.chat === "a")).toMatchObject({
      title: "Usage page",
      projectId: "p",
      project: "relay",
    });
    expect(s.threads.find((t) => t.chat === "big")!.title).toBe(
      "Deleted thread",
    );
    expect(s.threads.find((t) => t.chat === "b")!.provider).toBe("codex");
  });

  it("puts spend at a run's start hour and spreads its busy time", () => {
    // Monday Oct 5, 10:30 for an hour.
    const s = summary([
      run({
        at: at(5, 10, 30),
        ms: 60 * 60_000,
        models: { m: spend(7, 0, 1) },
      }),
    ]);
    expect(s.hours[10]).toMatchObject({ usd: 1, fresh: 7, minutes: 30 });
    expect(s.hours[11]).toMatchObject({ usd: 0, minutes: 30 });
    expect(s.weekdays[0]).toMatchObject({ usd: 1, minutes: 60, days: 1 });
    // Counted Oct 5 and 6, so every hour came round twice.
    expect(s.hours[3].days).toBe(2);
    expect(s.weekdays[1].days).toBe(1);
    expect(s.totals.agentMs).toBe(3_600_000);
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
  });

  it("names GPT models by version and name", () => {
    expect(modelLabel("gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(modelLabel("gpt-6-luna")).toBe("GPT-6 Luna");
    expect(modelLabel("gpt-5.5")).toBe("GPT-5.5");
    expect(modelLabel("opencode/deepseek-v4.1-flash")).toBe(
      "opencode/deepseek-v4.1-flash",
    );
  });
});
