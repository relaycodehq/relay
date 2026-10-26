import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { guideColumns, indentOf } from "./indent-levels";

const doc = Text.of(["class A {", "  run() {", "    go();", "", "    stop();", "  }", "}"]);

describe("guideColumns", () => {
  it("gives a line one guide per indent unit it sits inside", () => {
    expect(guideColumns(doc, 1, 7, 4)).toEqual([[], [0], [0, 2], [0, 2], [0, 2], [0], []]);
  });

  it("keeps a doc comment's stars at its opener's guides", () => {
    const comment = Text.of(["/**", " * Runs.", " */", "class A {", "  /**", "   * Goes.", "   */", "  go() {}", "}"]);
    expect(guideColumns(comment, 1, 9, 4)).toEqual([[], [], [], [], [0], [0], [0], [0], []]);
  });

  it("puts guides where the enclosing lines start, not every indent unit", () => {
    const deep = Text.of(["class A {", "  run() {", "      go(", "          x,", "      );", "  }", "}"]);
    expect(guideColumns(deep, 1, 7, 4)).toEqual([[], [0], [0, 2], [0, 2, 6], [0, 2], [0], []]);
  });

  it("finds the lines a screen's first line is nested under above it", () => {
    expect(guideColumns(doc, 3, 5, 4)).toEqual([[0, 2], [0, 2], [0, 2]]);
  });

  it("counts tabs by the tab size", () => {
    expect(indentOf("\t\tx", 4)).toBe(8);
    expect(guideColumns(Text.of(["a {", "\tb {", "\t\tx"]), 1, 3, 4)).toEqual([[], [0], [0, 4]]);
  });
});
