import { describe, expect, it } from "vitest";
import { committedLine, lineChanges } from "./line-changes";

const text = (...lines: string[]) => lines.map((l) => `${l}\n`).join("");

describe("lineChanges", () => {
  it("finds nothing in an untouched or re-ended file", () => {
    expect(lineChanges(text("a", "b"), text("a", "b"))).toEqual([]);
    expect(lineChanges("a\nb\n", "a\r\nb\r\n")).toEqual([]);
    expect(lineChanges("", "")).toEqual([]);
  });

  it("tells added, modified and removed lines apart", () => {
    const committed = text("a", "b", "c", "d", "e", "f");
    const buffer = text("a", "new", "b", "C", "d", "f");
    expect(lineChanges(committed, buffer)).toEqual([
      { line: 2, added: 1, removed: 0 },
      { line: 4, added: 1, removed: 1 },
      { line: 6, added: 0, removed: 1 },
    ]);
  });

  it("puts lines removed from the end after the last line", () => {
    expect(lineChanges(text("a", "b", "c"), text("a"))).toEqual([
      { line: 2, added: 0, removed: 2 },
    ]);
    expect(lineChanges(text("a"), "")).toEqual([
      { line: 1, added: 0, removed: 1 },
    ]);
  });

  it("marks every line of a file new since the commit", () => {
    expect(lineChanges("", text("a", "b"))).toEqual([
      { line: 1, added: 2, removed: 0 },
    ]);
  });

  it("gives up on a huge rewrite with one change instead of hanging", () => {
    const many = (tag: string) =>
      Array.from({ length: 5000 }, (_, i) => `${tag}${i}\n`).join("");
    expect(
      lineChanges(`top\n${many("x")}end\n`, `top\n${many("y")}end\n`),
    ).toEqual([{ line: 2, added: 5000, removed: 5000 }]);
  });
});

describe("committedLine", () => {
  it("follows unchanged lines past edits and has none for edited ones", () => {
    const hunks = lineChanges(
      text("a", "b", "c", "d", "e", "f"),
      text("a", "new", "b", "C", "d", "f"),
    );
    expect(
      [1, 2, 3, 4, 5, 6].map((line) => committedLine(hunks, line)),
    ).toEqual([1, undefined, 2, undefined, 4, 6]);
  });
});
