import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { php } from "@codemirror/lang-php";
import type { LanguageSupport } from "@codemirror/language";
import {
  extendSelection,
  selectionSteps,
  shrinkSelection,
} from "./expand-selection";

function editor(text: string, language: LanguageSupport) {
  const caret = text.indexOf("|");
  let state = EditorState.create({
    doc: text.replace("|", ""),
    selection: EditorSelection.cursor(caret),
    extensions: [language, selectionSteps],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const run = (command: typeof extendSelection) =>
    command({ state, dispatch: (tr) => (state = tr.state) });
  return {
    grow: () => (run(extendSelection), selected()),
    shrink: () => (run(shrinkSelection), selected()),
    move: (pos: number) => {
      state = state.update({ selection: EditorSelection.cursor(pos) }).state;
    },
  };
  function selected() {
    const { from, to } = state.selection.main;
    return state.sliceDoc(from, to);
  }
}

describe("extend selection", () => {
  it("grows from a word through the string's contents to the call", () => {
    const e = editor('log(fo|rmat("a b", 2));', javascript());
    expect(e.grow()).toBe("format");
    expect(e.grow()).toBe('format("a b", 2)');
    expect(e.grow()).toBe('(format("a b", 2))');
    expect(e.grow()).toBe('log(format("a b", 2))');
  });

  it("selects inside quotes before the quotes", () => {
    const e = editor('say("hel|lo there");', javascript());
    expect(e.grow()).toBe("hello");
    expect(e.grow()).toBe("hello there");
    expect(e.grow()).toBe('"hello there"');
  });

  it("selects a block's statements before its braces", () => {
    const e = editor("fn main() {\n    let x| = 1;\n}\n", rust());
    expect(e.grow()).toBe("x");
    const steps: string[] = [];
    for (let i = 0; i < 6; i++) steps.push(e.grow());
    expect(steps).toContain("let x = 1;");
    expect(steps).toContain("{\n    let x = 1;\n}");
    expect(steps.indexOf("let x = 1;")).toBeLessThan(
      steps.indexOf("{\n    let x = 1;\n}"),
    );
  });

  it("takes the loop around a call before the block's contents", () => {
    const e = editor(
      "fn f() {\n    let n = 1;\n    for w in t.sp|lit() {\n        g(w);\n    }\n}\n",
      rust(),
    );
    const steps = Array.from({ length: 6 }, () => e.grow());
    expect(steps.slice(0, 3)).toEqual(["split", "t.split", "t.split()"]);
    expect(steps).toContain("for w in t.split() {\n        g(w);\n    }");
    expect(steps).not.toContain("    for w in t.split() {");
  });

  it("grows through a PHP method call like PhpStorm", () => {
    const e = editor(
      '<?php\nclass A {\n  function f() {\n    return $this->fo|rmat("a b", $x);\n  }\n}\n',
      php(),
    );
    const steps = Array.from({ length: 5 }, () => e.grow());
    expect(steps[0]).toBe("format");
    expect(steps).toContain('$this->format("a b", $x)');
    expect(steps).toContain('return $this->format("a b", $x);');
  });

  it("selects lines in plain text", () => {
    const e = editor("one\ntw|o three\nfour", javascript());
    expect(e.grow()).toBe("two");
  });

  it("shrinks back the way it came and forgets after a move", () => {
    const e = editor('log(fo|rmat("a b", 2));', javascript());
    e.grow();
    e.grow();
    expect(e.shrink()).toBe("format");
    expect(e.shrink()).toBe("");
    e.grow();
    e.move(0);
    expect(e.shrink()).toBe("");
  });
});
