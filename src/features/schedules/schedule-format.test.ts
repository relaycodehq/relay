import { describe, expect, it } from "vitest";
import { fromNow } from "./schedule-format";

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

describe("fromNow", () => {
  it("doesn't call a run later today tomorrow", () => {
    // Just after midnight, the 23:00 run is still today's.
    expect(fromNow(at(2026, 11, 5, 23), at(2026, 11, 5, 0, 30))).toBe("in 23h");
  });

  it("says tomorrow for tomorrow's run once it is far off", () => {
    expect(fromNow(at(2026, 11, 6, 9), at(2026, 11, 5, 8))).toBe("tomorrow");
    expect(fromNow(at(2026, 11, 6, 9), at(2026, 11, 5, 22))).toBe("in 11h");
  });

  it("counts calendar days further out", () => {
    expect(fromNow(at(2026, 11, 8, 9), at(2026, 11, 5, 22))).toBe("in 3 days");
  });
});
