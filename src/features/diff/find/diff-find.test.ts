import { describe, expect, it } from "vitest";
import { parseDiffFromFile } from "@pierre/diffs";
import {
  diffLines,
  findMatches,
  lineKey,
  matchesByLine,
  MAX_MATCHES,
  stepMatch,
} from "./diff-find";

const file = (lines: string[]) => lines.map((l) => `${l}\n`).join("");
const numbered = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}`);

// 20 lines; line 3 changes and line 18 is removed, far enough apart for two hunks.
const before = numbered(20);
const after = [...before];
after[2] = "line three, Needle here";
after.splice(17, 1);
const diff = parseDiffFromFile(
  { name: "a.ts", contents: file(before) },
  { name: "a.ts", contents: file(after) },
  { context: 2 },
);

describe("diffLines", () => {
  it("lists what the hunks show, deletions before additions", () => {
    const lines = diffLines(diff);
    expect(diff.hunks).toHaveLength(2);
    expect(lines.slice(0, 6)).toEqual([
      { side: "additions", line: 1, oldLine: 1, text: "line 1" },
      { side: "additions", line: 2, oldLine: 2, text: "line 2" },
      { side: "deletions", line: 3, text: "line 3" },
      { side: "additions", line: 3, text: "line three, Needle here" },
      { side: "additions", line: 4, oldLine: 4, text: "line 4" },
      { side: "additions", line: 5, oldLine: 5, text: "line 5" },
    ]);
    // The second hunk: lines 16–17 around old line 18, then 19–20 numbered 18–19.
    expect(lines.slice(6)).toEqual([
      { side: "additions", line: 16, oldLine: 16, text: "line 16" },
      { side: "additions", line: 17, oldLine: 17, text: "line 17" },
      { side: "deletions", line: 18, text: "line 18" },
      { side: "additions", line: 18, oldLine: 19, text: "line 19" },
      { side: "additions", line: 19, oldLine: 20, text: "line 20" },
    ]);
  });

  it("adds the unchanged code between hunks for a fully expanded diff", () => {
    const lines = diffLines(diff, true);
    const kept = lines.filter((l) => l.side === "additions");
    expect(kept.map((l) => l.line)).toEqual(
      Array.from({ length: 19 }, (_, i) => i + 1),
    );
    expect(lines.find((l) => l.line === 10)).toEqual({
      side: "additions",
      line: 10,
      oldLine: 10,
      text: "line 10",
    });
  });
});

describe("findMatches", () => {
  const lines = diffLines(diff);

  it("finds every occurrence, ignoring case, in reading order", () => {
    const matches = findMatches(lines, "LINE 1");
    expect(
      matches.map((m) => [lines[m.at].side, lines[m.at].line, m.start]),
    ).toEqual([
      ["additions", 1, 0],
      ["additions", 16, 0],
      ["additions", 17, 0],
      ["deletions", 18, 0],
      ["additions", 18, 0],
    ]);
    expect(findMatches(lines, "needle")).toEqual([
      { at: 3, start: 12, end: 18 },
    ]);
  });

  it("finds repeats within a line without overlapping them", () => {
    expect(
      findMatches([{ side: "additions", line: 1, text: "aaaa" }], "aa"),
    ).toEqual([
      { at: 0, start: 0, end: 2 },
      { at: 0, start: 2, end: 4 },
    ]);
  });

  it("finds nothing for an empty query and stops at the cap", () => {
    expect(findMatches(lines, "")).toEqual([]);
    const many = [
      {
        side: "additions" as const,
        line: 1,
        text: "x".repeat(MAX_MATCHES + 5),
      },
    ];
    expect(findMatches(many, "x")).toHaveLength(MAX_MATCHES);
  });

  it("keeps offsets right on a line lowercasing would lengthen", () => {
    const text = "İstanbul and Ankara";
    expect(
      findMatches([{ side: "additions", line: 1, text }], "Ankara"),
    ).toEqual([{ at: 0, start: 13, end: 19 }]);
  });
});

describe("matchesByLine", () => {
  it("files an unchanged line's match under both of its numbers", () => {
    const lines = diffLines(diff);
    const matches = findMatches(lines, "line 19");
    const byLine = matchesByLine(lines, matches);
    expect(byLine.get(lineKey("additions", 18))).toEqual([0]);
    expect(byLine.get(lineKey("deletions", 19))).toEqual([0]);
    expect(byLine.size).toBe(2);
  });
});

describe("stepMatch", () => {
  it("wraps around both ways", () => {
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(0);
  });
});
