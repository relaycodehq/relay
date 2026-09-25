import { describe, expect, it } from "vitest";
import { WEEK_MS, presentWindow } from "../../shared/provider-usage";
import {
  activeHours,
  addSample,
  type UsageSample,
} from "../../shared/usage-history";

// Local times, since working hours are learned per local hour of the day.
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 8, day, hour, minute).getTime();
const nineToFive = Array.from({ length: 24 }, (_, h) =>
  h >= 9 && h < 17 ? 1 : 0,
);

/** Relay open 8:00–20:00 on each day, with the session climbing 9–17. */
function workdays(days: number[]): UsageSample[] {
  let samples: UsageSample[] = [];
  let session = 0;
  for (const day of days) {
    for (let m = 8 * 60; m < 20 * 60; m += 10) {
      const hour = Math.floor(m / 60);
      // This reading includes the ten minutes of work before it.
      const worked = Math.floor((m - 10) / 60);
      if (worked >= 9 && worked < 17) session++;
      samples = addSample(samples, {
        at: at(day, hour, m % 60),
        session,
        weekly: null,
      });
    }
  }
  return samples;
}

describe("usage history", () => {
  it("learns the hours usage climbs once five days are seen", () => {
    expect(activeHours(workdays([14, 15, 16, 17]))).toBeNull();
    const hours = activeHours(workdays([14, 15, 16, 17, 18]));
    expect(hours).toEqual(
      Array.from({ length: 24 }, (_, h) => (h >= 9 && h < 17 ? 1 : 0)),
    );
  });

  it("doesn't read activity across a gap where Relay was closed", () => {
    const samples: UsageSample[] = [];
    for (const day of [14, 15, 16, 17, 18]) {
      samples.push(
        { at: at(day, 8), session: 1, weekly: 1 },
        { at: at(day, 8, 20), session: 1, weekly: 1 },
        { at: at(day, 14), session: 30, weekly: 5 },
      );
    }
    expect(activeHours(samples)).toBeNull();
  });
});

describe("weekly pace over working hours", () => {
  const week = (usedPercent: number) => ({
    kind: "weekly" as const,
    usedPercent,
    resetsAt: at(21, 0) + WEEK_MS,
    periodMs: WEEK_MS,
  });

  it("holds the pace mark still overnight", () => {
    const evening = presentWindow(week(10), at(21, 20), nineToFive);
    const morning = presentWindow(week(10), at(22, 8), nineToFive);
    expect(evening.paceLeftPercent).toBeCloseTo((48 / 56) * 100, 5);
    expect(morning.paceLeftPercent).toBeCloseTo(evening.paceLeftPercent!, 5);
    // Wall-clock pacing slides it on through the night.
    expect(presentWindow(week(10), at(22, 8)).paceLeftPercent).toBeLessThan(
      presentWindow(week(10), at(21, 20)).paceLeftPercent!,
    );
  });

  it("keeps a run-out amber while only a little past the mark", () => {
    // 2 hours in: the mark is at ~96% left and 8% is used.
    const meter = presentWindow(week(8), at(21, 11), nineToFive);
    expect(meter).toMatchObject({ leftPercent: 92, pace: "warn" });
    expect(meter.limitLabel).toMatch(/^Out in ~/);
    expect(presentWindow(week(20), at(21, 11), nineToFive).pace).toBe("hot");
  });
});
