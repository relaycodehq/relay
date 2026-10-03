import { describe, expect, it } from "vitest";
import { cellBlock, toTsv, tsvCell } from "./table-tsv";

describe("tsvCell", () => {
  it("keeps a cell on one line so it stays one cell", () => {
    expect(tsvCell("first\nsecond")).toBe("first second");
    expect(tsvCell("a\t b")).toBe("a b");
    expect(tsvCell("a \r\n\n  b")).toBe("a b");
    expect(tsvCell("  padded  ")).toBe("padded");
  });

  it("leaves spaces inside a line alone", () => {
    expect(tsvCell("two  spaces")).toBe("two  spaces");
  });
});

describe("toTsv", () => {
  it("joins cells with tabs and rows with newlines", () => {
    expect(
      toTsv([
        ["Name", "Size"],
        ["a.ts", "1 KB"],
        ["multi\nline", ""],
      ]),
    ).toBe("Name\tSize\na.ts\t1 KB\nmulti line\t");
  });
});

describe("cellBlock", () => {
  it("is nothing without cells", () => {
    expect(cellBlock([])).toBeNull();
  });

  it("widens a reading-order selection across rows to every column it passed", () => {
    // From the middle of row 1 to the start of row 3 in a three-column table.
    expect(
      cellBlock([
        { row: 1, col: 1 },
        { row: 1, col: 2 },
        { row: 2, col: 0 },
        { row: 2, col: 1 },
        { row: 2, col: 2 },
        { row: 3, col: 0 },
      ]),
    ).toEqual({ top: 1, bottom: 3, left: 0, right: 2 });
  });

  it("keeps a selection within one row to the cells it covers", () => {
    expect(
      cellBlock([
        { row: 0, col: 1 },
        { row: 0, col: 2 },
      ]),
    ).toEqual({ top: 0, bottom: 0, left: 1, right: 2 });
  });
});
