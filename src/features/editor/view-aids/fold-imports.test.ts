import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { importsRange } from "./fold-imports";

const state = (doc: string) => EditorState.create({ doc, extensions: javascript({ typescript: true }) });

describe("importsRange", () => {
  it("covers the run of imports after the first keyword", () => {
    const doc = ['// header', 'import { a } from "a";', 'import {', "  b,", '} from "b";', "", "export const c = a + b;"].join("\n");
    const range = importsRange(state(doc))!;
    expect(doc.slice(range.from - "import".length, range.to)).toBe(doc.split("\n").slice(1, 5).join("\n"));
  });

  it("leaves a single one-line import alone", () => {
    expect(importsRange(state('import a from "a";\nrun(a);'))).toBeNull();
  });
});
