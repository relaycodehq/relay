import { describe, expect, it } from "vitest";
import {
  summarizeUsage,
  type UsageEntry,
  type UsageSlot,
} from "../../../shared/usage";
import { busiestStretch, ledeFor, rhythm } from "./rhythm";

const slot = (usd: number, days: number): UsageSlot => ({
  usd,
  fresh: 0,
  minutes: 0,
  days,
});

describe("busiestStretch", () => {
  it("wraps a late-night stretch past midnight", () => {
    const values = Array<number>(24).fill(1);
    for (const h of [22, 23, 0, 1]) values[h] = 10;
    expect(busiestStretch(values)).toBe(22);
  });

  it("has no stretch before anything was counted", () => {
    expect(busiestStretch(Array<number>(24).fill(0))).toBeNull();
  });
});

describe("rhythm", () => {
  const hours = Array.from({ length: 24 }, (_, h) => slot(h === 9 ? 5 : 0, 14));

  it("ranks weekdays by their average day, not their sum", () => {
    // Three Wednesdays outspend two Tuesdays in sum, not per day.
    const week = [0, 1, 2, 3, 4, 5, 6].map((d) =>
      d === 1 ? slot(500, 2) : d === 2 ? slot(600, 3) : slot(0, 2),
    );
    expect(rhythm(hours, week, "usd")).toEqual({ start: 6, weekday: 1 });
  });

  it("names no weekday under two weeks counted", () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((d) => slot(d, d < 6 ? 2 : 1));
    expect(rhythm(hours, week, "usd").weekday).toBeNull();
  });
});

describe("ledeFor", () => {
  const now = new Date(2026, 10, 10, 12).getTime();
  const answer = (usd?: number): UsageEntry => ({
    at: new Date(2026, 10, 10, 9).getTime(),
    ms: 0,
    provider: "claude",
    job: "thread",
    answer: true,
    models: {
      mystery: {
        tokens: { input: 100, cacheWrite: 0, cacheRead: 0, output: 10 },
        usd,
        requests: 1,
      },
    },
  });
  const summary = (entries: UsageEntry[]) =>
    summarizeUsage(entries, { range: "7d", now, chats: [] });

  it("names the stretch when there is one", () => {
    expect(ledeFor(summary([answer(2)]), "usd")).toMatchObject({
      rhythm: true,
      stretch: "06:00–10:00",
    });
  });

  it("says why there is nothing to chart in dollars when no model had a price", () => {
    expect(ledeFor(summary([answer()]), "usd")).toEqual({
      rhythm: false,
      sentence:
        "These answers came without a price; Tokens shows what they used.",
    });
  });

  it("says a stretch was quiet when nothing was counted", () => {
    expect(ledeFor(summary([]), "usd")).toMatchObject({
      rhythm: false,
      sentence: "A quiet stretch: nothing counted in these days.",
    });
  });
});
