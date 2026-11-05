import { describe, expect, it } from "vitest";
import { chunks, commandLineRuns } from "./chunks";

describe("chunks", () => {
  it("splits into runs of at most the size, keeping order", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("gives nothing for an empty list and one run for a short one", () => {
    expect(chunks([], 100)).toEqual([]);
    expect(chunks(["a"], 100)).toEqual([["a"]]);
  });
});

describe("commandLineRuns", () => {
  it("keeps each run's paths under 24k characters, in order", () => {
    const paths = Array.from({ length: 100 }, (_, i) => `${i}`.padEnd(1000));
    const runs = commandLineRuns(paths);
    expect(runs.flat()).toEqual(paths);
    expect(runs.map((r) => r.length)).toEqual([23, 23, 23, 23, 8]);
  });

  it("gives a path longer than that a run of its own", () => {
    expect(commandLineRuns(["a", "b".repeat(30_000), "c"])).toEqual([
      ["a"],
      ["b".repeat(30_000)],
      ["c"],
    ]);
  });
});
