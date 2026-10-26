import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { lineDashes } from "./minimap-paint";

describe("lineDashes", () => {
  it("draws each run of characters, skipping spaces and counting tabs", () => {
    const state = EditorState.create({ doc: "let  a = 1;\n\tb();", extensions: EditorState.tabSize.of(4) });
    const dashes = lineDashes(state, 1, 2).map((runs) => runs.map((d) => [d.column, d.length]));
    expect(dashes).toEqual([
      [[0, 3], [5, 1], [7, 1], [9, 2]],
      [[4, 4]],
    ]);
  });
});
