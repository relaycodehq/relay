import { describe, expect, it } from "vitest";
import { diffRowMetrics } from "./diff-metrics";

describe("diffRowMetrics", () => {
  it("counts the gap the library paints under each file", () => {
    expect(diffRowMetrics(12)).toMatchObject({
      paddingTop: 0,
      paddingBottom: 8,
      spacing: 0,
      hunkSeparatorHeight: 32,
    });
  });
});
