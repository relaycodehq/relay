import { expect, it } from "vitest";
import { indentedNewline } from "./newline-indent";

const at = (line: number, character: number) => ({ line, character });

it("keeps the line's indentation", () => {
  expect(indentedNewline("a\n    b", at(1, 5))).toEqual({
    text: "\n    ",
    caret: at(2, 4),
  });
});

it("indents one level after an opening bracket, by the file's narrowest indent", () => {
  const text = "f(\n  a,\n    b\n)";
  expect(indentedNewline(text, at(0, 2))).toEqual({
    text: "\n  ",
    caret: at(1, 2),
  });
});

it("caps the level at four spaces and uses a tab when any line starts with one", () => {
  expect(indentedNewline("if {\n        x", at(0, 4)).text).toBe("\n    ");
  expect(indentedNewline("if {\n\tx\n  y", at(0, 4)).text).toBe("\n\t");
});

it("puts a closing bracket right after the caret on its own line", () => {
  expect(indentedNewline("  call({})", at(0, 8))).toEqual({
    text: "\n    \n  ",
    caret: at(1, 4),
  });
  expect(indentedNewline("[ ]", at(0, 2)).text).toBe("\n    \n");
});

it("doesn't indent after a closing bracket or when text follows the opener", () => {
  expect(indentedNewline("  f()", at(0, 5)).text).toBe("\n  ");
  expect(indentedNewline("  f(a", at(0, 5)).text).toBe("\n  ");
});

it("ends lines the way the file does", () => {
  expect(indentedNewline("a {\r\n  b\r\n}", at(0, 3))).toEqual({
    text: "\r\n  ",
    caret: at(1, 2),
  });
});

it("treats a caret past the last line as an empty line", () => {
  expect(indentedNewline("  a", at(3, 0))).toEqual({
    text: "\n",
    caret: at(4, 0),
  });
});
