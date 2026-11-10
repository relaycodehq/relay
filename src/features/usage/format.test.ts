import { describe, expect, it } from "vitest";
import { summarizeUsage } from "../../../shared/usage";
import { answerCount, periodLabel } from "./format";

describe("answerCount", () => {
  it("says one answer in the singular", () => {
    expect(answerCount(1)).toBe("1 answer");
    expect(answerCount(0)).toBe("0 answers");
    expect(answerCount(2310)).toBe("2,310 answers");
  });
});

describe("periodLabel", () => {
  const summary = (first: Date, last: Date) =>
    summarizeUsage(
      [
        {
          at: first.getTime(),
          ms: 0,
          provider: "claude",
          job: "thread",
          answer: true,
          models: {},
        },
      ],
      { range: "all", now: last.getTime(), chats: [] },
    );

  it("reads one day as one date", () => {
    const s = summary(new Date(2026, 10, 10, 8), new Date(2026, 10, 10, 9));
    expect(periodLabel(s)).toBe("Nov 10");
    expect(periodLabel(s, true)).toBe("Nov 10, 2026");
  });

  it("puts the year once, at the end, inside a year", () => {
    const s = summary(new Date(2026, 9, 2, 8), new Date(2026, 9, 11, 9));
    expect(periodLabel(s)).toBe("Oct 2 – Oct 11");
    expect(periodLabel(s, true)).toBe("Oct 2 – Oct 11, 2026");
  });

  it("puts a year on both ends across New Year", () => {
    const s = summary(new Date(2026, 11, 28, 8), new Date(2027, 0, 3, 9));
    expect(periodLabel(s)).toBe("Dec 28, 2026 – Jan 3, 2027");
    expect(periodLabel(s, true)).toBe("Dec 28, 2026 – Jan 3, 2027");
  });

  it("tells a year apart from the same date a year on", () => {
    const s = summary(new Date(2025, 10, 10, 8), new Date(2026, 10, 10, 9));
    expect(periodLabel(s)).toBe("Nov 10, 2025 – Nov 10, 2026");
  });
});
