import { describe, expect, it } from "vitest";
import type { UsageSlot } from "../../../shared/usage";
import { busiestStretch, rhythm } from "./rhythm";

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
