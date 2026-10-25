import { describe, expect, it } from "vitest";
import { withBlankLines } from "./blank-lines";

const code = (...lines: string[]) => lines.join("\n");

describe("blank lines", () => {
  it("spaces out functions and the class members around a method", () => {
    const packed = code(
      "const own = (id: string) => id;",
      "function a() {",
      "  return 1;",
      "}",
      "export class Shells {",
      "  private devices = new Map();",
      "  private link?: Link;",
      "  connect(link: Link) {",
      "    this.link = link;",
      "  }",
      "  /** Its own shells. */",
      "  close() {}",
      "}",
    );
    expect(withBlankLines(packed, false)).toBe(
      code(
        "const own = (id: string) => id;",
        "",
        "function a() {",
        "  return 1;",
        "}",
        "",
        "export class Shells {",
        "  private devices = new Map();",
        "  private link?: Link;",
        "",
        "  connect(link: Link) {",
        "    this.link = link;",
        "  }",
        "",
        "  /** Its own shells. */",
        "  close() {}",
        "}",
      ),
    );
  });

  it("keeps imports, overloads and one-liners together", () => {
    const together = code(
      "import {",
      "  a,",
      '} from "./a";',
      'import { b } from "./b";',
      "const x = 1;",
      "const y = 2;",
      "export function f(a: string): string;",
      "export function f(a: number): number;",
      "export function f(a: unknown) {",
      "  return a;",
      "}",
    );
    expect(withBlankLines(together, false)).toBe(together);
  });

  it("leaves what a template literal says alone", () => {
    const template = code(
      "const fixture = `",
      "function a() {",
      "}",
      "function b() {",
      "}",
      "`;",
    );
    expect(withBlankLines(template, false)).toBe(template);
  });

  it("spaces test blocks, but not the first in a describe or a braceless if's body", () => {
    const tests = code(
      'describe("x", () => {',
      '  it("a", () => {});',
      '  it("b", () => {});',
      '  if (provider === "claude")',
      '    it("c", () => {});',
      "});",
    );
    expect(withBlankLines(tests, true)).toBe(
      code(
        'describe("x", () => {',
        '  it("a", () => {});',
        "",
        '  it("b", () => {});',
        '  if (provider === "claude")',
        '    it("c", () => {});',
        "});",
      ),
    );
  });
});
