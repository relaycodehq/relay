import { expect, it } from "vitest";
import { quoteExcerpt, quoteMarkdown } from "./composer-quotes";

it("quotes a short message whole", () => {
  expect(quoteMarkdown(quoteExcerpt("One\n\n\n\nTwo  "))).toBe("> One\n> \n> Two\n\n");
});

it("cuts a long message at its first lines, marked", () => {
  const body = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
  expect(quoteExcerpt(body, 3)).toBe("line 1\nline 2\nline 3 …");
});

it("cuts a long line between words", () => {
  expect(quoteExcerpt("alpha beta gamma delta", 8, 13)).toBe("alpha beta …");
});
