import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { lineBreakOf, minimalChange } from "./text-changes";

const stateOf = (text: string) =>
  EditorState.create({
    doc: text,
    extensions: EditorState.lineSeparator.of(lineBreakOf(text)),
  });

describe("line breaks", () => {
  it("keeps CRLF files CRLF and mixed files byte for byte", () => {
    expect(lineBreakOf("a\r\nb\r\n")).toBe("\r\n");
    expect(lineBreakOf("a\nb\n")).toBe("\n");
    const mixed = "a\r\nb\nc";
    expect(lineBreakOf(mixed)).toBe("\n");
    expect(stateOf(mixed).sliceDoc()).toBe(mixed);
    expect(stateOf("x\r\ny\r\n").sliceDoc()).toBe("x\r\ny\r\n");
  });
});

describe("minimalChange", () => {
  it("edits only the middle that differs, in CRLF files too", () => {
    const state = stateOf("one\r\ntwo\r\nthree\r\n");
    const changes = minimalChange(state, "one\r\nTWO\r\nthree\r\n");
    const touched: [number, number][] = [];
    changes.iterChangedRanges((from, to) => touched.push([from, to]));
    expect(touched).toEqual([[4, 7]]);
    const next = state.update({ changes }).state;
    expect(next.sliceDoc()).toBe("one\r\nTWO\r\nthree\r\n");
  });

  it("handles growing and emptying a file", () => {
    const state = stateOf("");
    const grown = state.update({ changes: minimalChange(state, "a\nb") }).state;
    expect(grown.sliceDoc()).toBe("a\nb");
    const emptied = grown.update({ changes: minimalChange(grown, "") }).state;
    expect(emptied.sliceDoc()).toBe("");
  });
});
