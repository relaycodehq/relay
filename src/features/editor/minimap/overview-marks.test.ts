import { describe, expect, it } from "vitest";
import { changeMarks, stripeSpan } from "./overview-marks";

describe("changeMarks", () => {
  it("tells added, changed and removed lines apart", () => {
    const marks = changeMarks([
      { line: 3, added: 2, oldLine: 3, removed: 0 },
      { line: 10, added: 1, oldLine: 8, removed: 1 },
      { line: 20, added: 0, oldLine: 18, removed: 4 },
    ]);
    expect(marks.map((m) => [m.kind, m.line, m.lines, m.label])).toEqual([
      ["added", 3, 2, "2 lines added"],
      ["modified", 10, 1, "1 line changed"],
      ["removed", 20, 0, "4 lines removed"],
    ]);
  });
});

describe("stripeSpan", () => {
  const mark = (line: number, lines: number) => ({ kind: "added" as const, line, lines, label: "" });

  it("places a mark by where its lines are in the whole file", () => {
    expect(stripeSpan(mark(51, 10), 100, 400)).toEqual({ top: 200, height: 40 });
  });

  it("keeps a one-line change in a long file visible and on the stripe", () => {
    expect(stripeSpan(mark(5000, 1), 5000, 500)).toEqual({ top: 497, height: 3 });
  });
});
