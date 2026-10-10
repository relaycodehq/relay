import { describe, expect, it } from "vitest";
import { normalizeMath } from "./math-delimiters";

describe("normalizeMath", () => {
  it.each([
    ["inline parens", "so \\(x^2\\) holds", "so $$x^2$$ holds"],
    ["inline brackets", "so \\[a_1 + b\\] holds", "so $$a_1 + b$$ holds"],
    [
      "pandoc dollars",
      "so $x_1$ and $\\alpha$.",
      "so $$x_1$$ and $$\\alpha$$.",
    ],
    [
      "a formula after prices",
      "It costs $5 and $10, and $x_1$ is free.",
      "It costs $5 and $10, and $$x_1$$ is free.",
    ],
    ["display on one line", "$$ E = mc^2 $$", "$$\nE = mc^2\n$$"],
    ["bracket display on one line", "\\[ E = mc^2 \\]", "$$\nE = mc^2\n$$"],
    [
      "bracket display on several lines",
      "\\[\n a &= b \\\\\n c &= d\n\\]",
      "$$\n a &= b \\\\\n c &= d\n$$",
    ],
    [
      "formula text beside the fences",
      "$$ \\begin{aligned}\na &= b\n\\end{aligned} $$",
      "$$\n\\begin{aligned}\na &= b\n\\end{aligned}\n$$",
    ],
    ["fences in a quote", "> \\[\n> x^2\n> \\]", "> $$\n> x^2\n> $$"],
  ])("%s", (_, input, expected) => {
    expect(normalizeMath(input)).toBe(expected);
  });

  it.each([
    "It costs $5 and then $10.",
    "Between $5-$10 or $3 to $5.",
    "Set $HOME/$USER and $PATH:$HOME.",
    "A \\$5 fee and \\$x\\$.",
    "Tag \\[WIP\\] and \\[draft\\].",
    "Already $$x$$ inline stays.",
    "`$x$` and ``\\(x\\)`` are code",
    "```\n$x$\n\\[\n$$\n```",
  ])("leaves %j alone", (text) => {
    expect(normalizeMath(text)).toBe(text);
  });

  it("escapes a line that starts with $$ but is prose, so it opens no formula", () => {
    expect(normalizeMath("$$ is the PID of the shell")).toBe(
      "\\$$ is the PID of the shell",
    );
  });

  it("keeps the rest of a formula that is still streaming in", () => {
    expect(normalizeMath("Intro\n\n$$\n\\frac{a}{")).toBe(
      "Intro\n\n$$\n\\frac{a}{",
    );
    expect(normalizeMath("\\[\nx = \\frac{")).toBe("$$\nx = \\frac{");
  });

  it("does not let an unclosed bracket swallow the answer", () => {
    const text = "\\[WIP] first\n\nthen prose\n\nand more";
    expect(normalizeMath(text)).toBe(text);
  });

  it("changes nothing the second time", () => {
    for (const text of [
      "a \\(x\\) b $y_2$ c\n\n\\[\nz\n\\]\n\n$$\nw\n$$",
      "> $$ x $$\n\n- \\[ a^2 \\]",
      "$$\nunfinished",
    ])
      expect(normalizeMath(normalizeMath(text))).toBe(normalizeMath(text));
  });
});
