// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { lineChanges } from "../line-changes";
import { changeOnLine, changesOf, comparedWith, fileChanges, rollbackEdit } from "./file-changes";
import { inlineChanges } from "../useEditorChanges";

const docOf = (text: string) => Text.of(text.split(/\r?\n/));
const changes = (compared: string, buffer: string) => changesOf(lineChanges(compared, buffer));

describe("comparedWith", () => {
  const compared = ["import a;", "", "one();", "two();", "three();", ""].join("\n");
  const buffer = ["import a, b;", "", "one();", "two(2);", "three();", ""].join("\n");

  it("takes one change and leaves the others out", () => {
    const [imports, call] = changes(compared, buffer);
    expect(comparedWith(compared, docOf(buffer), "\n", imports)).toBe(compared.replace("import a;", "import a, b;"));
    expect(comparedWith(compared, docOf(buffer), "\n", call)).toBe(compared.replace("two();", "two(2);"));
  });

  it("keeps a CRLF file's line breaks, new lines included", () => {
    const crlf = "a\r\nb\r\nc\r\n";
    const edited = "a\r\nB\r\nnew\r\nc\r\n";
    const [change] = changes(crlf, edited);
    expect(comparedWith(crlf, docOf(edited), "\r\n", change)).toBe(edited);
  });

  it("carries a missing or added final line break", () => {
    const [dropped] = changes("a\nb\n", "a\nB");
    expect(comparedWith("a\nb\n", docOf("a\nB"), "\n", dropped)).toBe("a\nB");
    const [appended] = changes("a\nb", "a\nb\nc\n");
    expect(comparedWith("a\nb", docOf("a\nb\nc\n"), "\n", appended)).toBe("a\nb\nc\n");
    const [removedLast] = changes("a\nb\n", "a\n");
    expect(comparedWith("a\nb\n", docOf("a\n"), "\n", removedLast)).toBe("a\n");
  });

  it("adds a new file whole", () => {
    const [all] = changes("", "x\ny\n");
    expect(comparedWith("", docOf("x\ny\n"), "\n", all)).toBe("x\ny\n");
  });
});

describe("rollbackEdit", () => {
  const cases: [string, string][] = [
    ["a\nb\nc\n", "a\nX\nb\nc\n"],
    ["a\nX\nb\nc\n", "a\nb\nc\n"],
    ["a\nb\nc\n", "A\nb\nC"],
    ["a\nb", "a\nb\nc\nd\n"],
    ["a\nb\nc\n", "a\n"],
    ["", "new\n"],
  ];
  it.each(cases)("puts %j back from %j", (compared, buffer) => {
    let state = EditorState.create({ doc: buffer });
    // Last to first, so each edit's lines are still where they were found.
    for (const change of changes(compared, buffer).reverse())
      state = state.update({ changes: rollbackEdit(docOf(compared), state.doc, "\n", change) }).state;
    expect(state.sliceDoc()).toBe(compared);
  });
});

describe("changeOnLine", () => {
  it("finds a removal from the lines either side of it", () => {
    const list = changes("a\nb\nc\nd\n", "a\nd\n");
    expect(changeOnLine(list, 1)).toBe(list[0]);
    expect(changeOnLine(list, 2)).toBe(list[0]);
    expect(changeOnLine(list, 3)).toBeUndefined();
  });

  it("reads the inline view's chunks while it is on", () => {
    const state = EditorState.create({ doc: "a\nB\nc\n", extensions: inlineChanges("a\nb\nc\n") });
    expect(fileChanges(state)).toEqual([{ line: 2, added: 1, oldLine: 2, removed: 1 }]);
  });
});
