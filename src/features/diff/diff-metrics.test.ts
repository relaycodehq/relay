import { describe, expect, it } from "vitest";
import { diffRowMetrics, scrollPastEndSpace } from "./diff-metrics";

describe("diffRowMetrics", () => {
  it.each([
    [10, 20],
    [12, 22],
    [18, 28],
  ])("code size %i gives %i px rows", (size, row) => {
    expect(diffRowMetrics(size).lineHeight).toBe(row);
  });

  it("counts the gap the library paints under each file", () => {
    expect(diffRowMetrics(12)).toMatchObject({
      paddingTop: 0,
      paddingBottom: 8,
      spacing: 0,
      hunkSeparatorHeight: 32,
    });
  });
});

describe("scrollPastEndSpace", () => {
  it("is a third of the pane, rounded to a pixel", () => {
    expect(scrollPastEndSpace(640, true)).toBe(213);
    expect(scrollPastEndSpace(500, true)).toBe(167);
  });

  it("is zero when switched off or before the pane has a size", () => {
    expect(scrollPastEndSpace(640, false)).toBe(0);
    expect(scrollPastEndSpace(0, true)).toBe(0);
  });
});
