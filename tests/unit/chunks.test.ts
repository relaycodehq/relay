import { describe, expect, it } from "vitest";
import { chunks } from "../../electron/chunks";

describe("chunks", () => {
  it("splits into runs of at most the size, keeping order", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("gives nothing for an empty list and one run for a short one", () => {
    expect(chunks([], 100)).toEqual([]);
    expect(chunks(["a"], 100)).toEqual([["a"]]);
  });
});
