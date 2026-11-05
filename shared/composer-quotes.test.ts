import { expect, it } from "vitest";
import { quoteLabel, selectionQuote } from "./composer-quotes";

it("tidies a selection, keeping its indentation", () => {
  expect(selectionQuote("\r\n\n  one  \r\n\n\n\n\ttwo \n\n")).toBe(
    "  one\n\n\ttwo",
  );
});

it("tidies a selection with a long run of spaces at once", () => {
  const line = `a${" ".repeat(40_000)}b`;
  const started = performance.now();
  expect(selectionQuote(`${line}  \n`)).toBe(line);
  expect(performance.now() - started).toBeLessThan(500);
});

it("never cuts an emoji in half in a quote's label", () => {
  expect(quoteLabel("abcd🎉ef", 6)).toBe("abcd…");
});
