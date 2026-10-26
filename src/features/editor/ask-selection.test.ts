import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { selectedLines } from "./ask-selection";

const at = (anchor: number, head: number) =>
  EditorState.create({ doc: "one\ntwo\nthree\n", selection: { anchor, head } });

describe("selectedLines", () => {
  it("is nothing without a selection", () => {
    expect(selectedLines(at(2, 2))).toBeNull();
  });
  it("takes the whole lines a selection touches", () => {
    expect(selectedLines(at(1, 6))).toEqual({ start: 1, end: 2, code: "one\ntwo" });
  });
  it("leaves out the line a selection ends at the start of", () => {
    expect(selectedLines(at(0, 4))).toEqual({ start: 1, end: 1, code: "one" });
    expect(selectedLines(at(8, 4))).toEqual({ start: 2, end: 2, code: "two" });
  });
});
