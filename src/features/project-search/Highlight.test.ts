import { describe, expect, it } from "vitest";
import { rangesOf } from "./Highlight";

describe("rangesOf", () => {
  it("joins neighbouring positions into one range", () => {
    expect(rangesOf([1, 2, 4])).toEqual([
      { start: 1, length: 2 },
      { start: 4, length: 1 },
    ]);
  });

  it("shifts positions to a part of the path and drops those before it", () => {
    // "src/file.ts" with hits on s, f, i; the name starts at 4.
    expect(rangesOf([0, 4, 5], 4)).toEqual([{ start: 0, length: 2 }]);
  });
});
