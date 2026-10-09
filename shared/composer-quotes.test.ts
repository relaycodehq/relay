import { expect, it } from "vitest";
import { appendQuote, quoteExcerpt, quoteMarkdown } from "./composer-quotes";

it("quotes a short message whole with its internal blank lines", () => {
  expect(quoteMarkdown(quoteExcerpt("One\n\n\n\nTwo  "))).toBe(
    "> One\n> \n> \n> \n> Two\n\n",
  );
});

it("cuts a long message at its first lines, marked", () => {
  const body = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
  expect(quoteExcerpt(body, 3)).toBe("line 1\nline 2\nline 3 …");
});

it("cuts a long line between words", () => {
  expect(quoteExcerpt("alpha beta gamma delta", 8, 13)).toBe("alpha beta …");
});

it("closes a cut fence before the ellipsis, preserving code whitespace", () => {
  expect(quoteMarkdown(quoteExcerpt("```ts\n  x  \n\n\n  y\n```", 2))).toBe(
    "> ```ts\n>   x\n> ```\n> \n> …\n\n",
  );
  expect(quoteExcerpt("> ~~~js\n> code\n> more\n> ~~~", 2)).toBe(
    "> ~~~js\n> code\n> ~~~\n\n…",
  );
});

it("keeps closed fences and existing quote lines intact", () => {
  expect(quoteMarkdown(quoteExcerpt("> text\n\n```\nx\n```"))).toBe(
    "> > text\n> \n> ```\n> x\n> ```\n\n",
  );
});

it("doesn't leave half an emoji at the character limit", () => {
  expect(quoteExcerpt("abc😅def", 8, 4)).toBe("abc …");
});

it("appends after the existing draft with the cursor below the quote", () => {
  const quote = quoteMarkdown("answer");
  const appended = appendQuote("My draft  ", quote);
  expect(appended).toEqual({ text: "My draft\n\n> answer\n\n", end: 20 });
  expect(appendQuote("   ", quote)).toEqual({ text: quote, end: quote.length });
});

it("closes an unfinished fence even when the whole short message fits", () => {
  expect(quoteExcerpt("```js\nx")).toBe("```js\nx\n```");
});
