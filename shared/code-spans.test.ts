import { describe, expect, it } from "vitest";
import { codeSpans } from "./code-spans";

const OLD_CODE_SPAN = /(`+)(?:[^`]|[^`].*?[^`])\1(?!`)/g;

const byRegex = (line: string) =>
  [...line.matchAll(OLD_CODE_SPAN)].map((m) => ({
    index: m.index,
    text: m[0],
  }));

function randomLine(seed: number): string {
  const alphabet = "```` a$\r\u2028x";
  let state = seed,
    line = "";
  const length = seed % 40;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    line += alphabet[state % alphabet.length];
  }
  return line;
}

describe("codeSpans", () => {
  it("finds what the old expression found", () => {
    for (let seed = 0; seed < 20_000; seed++) {
      const line = randomLine(seed);
      expect(codeSpans(line), JSON.stringify(line)).toEqual(byRegex(line));
    }
  });

  it("opens mid-run and closes only at a run of the same length", () => {
    expect(codeSpans("``a` b")).toEqual([{ index: 1, text: "`a`" }]);
    expect(codeSpans("``a``` b``")).toEqual([{ index: 0, text: "``a``` b``" }]);
  });

  it("reads a long unclosed run of backticks in linear time", () => {
    const run = "$x " + "`".repeat(20_000);
    const started = performance.now();
    codeSpans(run);
    codeSpans(run.replaceAll("``", "` "));
    expect(performance.now() - started).toBeLessThan(100);
  });
});
