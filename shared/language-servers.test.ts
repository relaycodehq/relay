import { describe, expect, it } from "vitest";
import {
  applyLspEdits,
  lspPathSchema,
  offsetAt,
  type LspEdit,
} from "./language-servers";

const edit = (
  line: number,
  character: number,
  endLine: number,
  endCharacter: number,
  newText: string,
): LspEdit => ({ line, character, endLine, endCharacter, newText });

describe("offsetAt", () => {
  it("counts lines of every ending", () => {
    const text = "ab\r\ncd\nef\rgh";
    expect(offsetAt(text, 0, 1)).toBe(1);
    expect(offsetAt(text, 1, 0)).toBe(4);
    expect(offsetAt(text, 2, 1)).toBe(8);
    expect(offsetAt(text, 3, 2)).toBe(12);
  });

  it("clamps to the line and the text", () => {
    expect(offsetAt("ab\ncd", 0, 99)).toBe(2);
    expect(offsetAt("ab\ncd", 9, 0)).toBe(5);
  });
});

describe("applyLspEdits", () => {
  it("applies edits that all refer to the original text", () => {
    const text = "let a = 1;\nlet b = a;\n";
    expect(
      applyLspEdits(text, [
        edit(1, 8, 1, 9, "renamed"),
        edit(0, 4, 0, 5, "renamed"),
      ]),
    ).toBe("let renamed = 1;\nlet b = renamed;\n");
  });

  it("keeps insertions at one spot in the order given", () => {
    expect(
      applyLspEdits("x", [edit(0, 0, 0, 0, "A"), edit(0, 0, 0, 0, "B")]),
    ).toBe("ABx");
  });

  it("inserts before a replace that starts at the same spot", () => {
    expect(
      applyLspEdits("abcd", [edit(0, 0, 0, 0, "I"), edit(0, 0, 0, 1, "R")]),
    ).toBe("IRbcd");
  });

  it("counts characters as UTF-16, so a surrogate pair is two", () => {
    expect(applyLspEdits("😀x", [edit(0, 2, 0, 3, "y")])).toBe("😀y");
  });

  it("replaces across lines", () => {
    expect(applyLspEdits("a\nb\nc", [edit(0, 1, 2, 0, "-")])).toBe("a-c");
  });
});

describe("lspPathSchema", () => {
  it("takes paths in the workspace and absolute ones outside it", () => {
    for (const ok of [
      "src/a.rs",
      "a.rs",
      "/usr/lib/rustlib/lib.rs",
      "C:\\Users\\me\\a.rs",
      "C:/x/a.rs",
      "\\\\server\\share\\a.rs",
    ])
      expect(lspPathSchema.safeParse(ok).success).toBe(true);
  });

  it("refuses a way out of the workspace, backslashes in a relative path and junk", () => {
    for (const bad of [
      "../a.rs",
      "a/../../b",
      "a\\b.rs",
      "",
      "a\0b",
      "x".repeat(5000),
    ])
      expect(lspPathSchema.safeParse(bad).success).toBe(false);
  });
});
