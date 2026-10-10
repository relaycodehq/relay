import { describe, expect, it } from "vitest";
import { matchBlockMath, matchInlineMath } from "./marked-math";

describe("matchBlockMath", () => {
  it("takes a formula up to its closing line, blank lines included", () => {
    const token = matchBlockMath("$$\na = b\n\nc = d\n$$\nAfter");
    expect(token).toMatchObject({ text: "a = b\n\nc = d", closed: true });
    expect(token!.raw).toBe("$$\na = b\n\nc = d\n$$\n");
  });

  it("is open while the closing line hasn't arrived, and runs to the end", () => {
    expect(matchBlockMath("$$\n\\frac{a}{")).toMatchObject({
      text: "\\frac{a}{",
      closed: false,
    });
    expect(matchBlockMath("$$")).toMatchObject({ text: "", closed: false });
  });

  it("only starts at a line of its own", () => {
    expect(matchBlockMath("$$x$$ and more")).toBeUndefined();
    expect(matchBlockMath("text\n$$\nx\n$$")).toBeUndefined();
    expect(matchBlockMath("    $$\nx\n$$")).toBeUndefined();
  });
});

describe("matchInlineMath", () => {
  it("takes $$x$$ inside a line", () => {
    expect(matchInlineMath("$$ a_1 $$ and more")).toMatchObject({
      raw: "$$ a_1 $$",
      text: "a_1",
    });
  });

  it("leaves a lone or unfinished $$ as text", () => {
    expect(matchInlineMath("$$ never closed")).toBeUndefined();
    expect(matchInlineMath("$5 and $10")).toBeUndefined();
    expect(matchInlineMath("$$\nx$$")).toBeUndefined();
  });
});
