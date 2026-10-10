import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { markdownBlocks, mathClosed } from "./markdown-blocks";

const render = (text: string) =>
  renderToStaticMarkup(
    <Markdown remarkPlugins={[remarkGfm, remarkMath]}>{text}</Markdown>,
  );

/** Split and rendered block by block, `text` must look like it does whole. */
function expectSameAsWhole(text: string) {
  const blocks = markdownBlocks(text);
  expect(blocks.join("\n")).toBe(text);
  expect(blocks.map(render).join("\n")).toBe(render(text));
}

describe("markdownBlocks", () => {
  it.each([
    "# Title\n\nIntro paragraph.\n\n## Next\n\nMore text.",
    "- a\n- b\n\n- loose c\n\n  continued c\n\nAfter the list.",
    "1. one\n\n2. two\n\n10) ten\n\nDone.",
    "```ts\nconst a = 1;\n\nNot a paragraph\n```\n\nAfter code.",
    "~~~~\n```\n\nstill code\n~~~~\n\ntext",
    "Para\n\n    indented code\n\n    more code\n\nback",
    "| a | b |\n| - | - |\n| 1 | 2 |\n\nTable done.",
    "> quote\n\n> another\n\nplain",
    "Text\n\n---\n\n* * *\n\nEnd",
    "See [docs][ref].\n\n[ref]: https://example.com",
    "Footnote[^1].\n\n[^1]: The note.",
    "<!-- hidden\n\nstill hidden -->\n\nShown",
    "Term  \nbreak\n\n\n\nAfter blank lines\n",
    "- [ ] task\n- [x] done\n\n~~strike~~ and https://example.com",
    "\n\n\nLeading blank lines\n\nthen text",
  ])("renders %j the same split as whole", expectSameAsWhole);

  it("splits at blank lines between top-level blocks, not inside a fence", () => {
    expect(
      markdownBlocks("# Title\n\nIntro paragraph.\n\n## Next\n\nMore text."),
    ).toHaveLength(4);
    expect(
      markdownBlocks(
        "```ts\nconst a = 1;\n\nNot a paragraph\n```\n\nAfter code.",
      ),
    ).toHaveLength(2);
  });

  it.each([
    ["<pre>", "<pre>\nline one\n\nline two\n</pre>\n\nAfter"],
    ["<script>", "<script>\nconst a = 1;\n\nconst b = 2;\n</script>\n\nAfter"],
    [
      "<style>",
      "Before\n\n<style>\na { color: red }\n\nb { color: blue }\n</style>",
    ],
    ["<textarea>", "<TEXTAREA rows=2>\none\n\ntwo\n</textarea>\n\nAfter"],
    ["a processing instruction", "<?php\n\necho 1;\n?>\n\nAfter"],
    ["CDATA", "<![CDATA[\none\n\ntwo\n]]>\n\nAfter"],
    ["a declaration", "<!DOCTYPE html\n\nstill>\n\nAfter"],
    ["<pre> in a list item", "- <pre>\n\n  still pre\n  </pre>\n\nAfter"],
    [
      "a fence line inside an HTML block",
      "<div>\n```\n\ntext\n\n```\n\ncode\n```",
    ],
  ])("keeps %s that spans blank lines in one piece", (_, text) => {
    expectSameAsWhole(text);
    expect(markdownBlocks(text)).toEqual([text]);
  });

  it.each([
    ["a quote", "See [docs][ref].\n\n> [ref]: https://example.com"],
    [
      "a quote, before its use",
      "> [ref]: https://example.com\n\nSee [docs][ref].",
    ],
    ["a list item", "- [ref]: https://example.com\n\nSee [docs][ref]."],
    [
      "a list item's later paragraph",
      "- a\n\n  [ref]: https://example.com\n\nSee [docs][ref].",
    ],
    ["a quoted list", "> 1. [ref]: https://example.com\n\nSee [docs][ref]."],
    ["a quote, for a footnote", "Note[^1].\n\n> [^1]: The note.\n\nAfter"],
    ["a list item, for a footnote", "- [^1]: The note.\n\nNote[^1]."],
  ])("resolves a definition inside %s", (_, text) => {
    expectSameAsWhole(text);
    expect(markdownBlocks(text)).toEqual([text]);
  });

  it("still splits around what only looks like HTML or a definition", () => {
    const samples = [
      "```html\n<pre>\n\n<!-- note -->\n</pre>\n```\n\nAfter the sample.",
      "```ts\ntype Map = {\n  [key: string]: number;\n};\n```\n\nAfter the sample.",
      "<https://example.com> is an autolink.\n\nNext paragraph.",
      "Inline <!-- comment --> and x <pre> y.\n\nNext paragraph.",
      "a < b and [x]: later in the line.\n\nNext paragraph.",
    ];
    for (const text of samples) {
      expectSameAsWhole(text);
      expect(markdownBlocks(text)).toHaveLength(2);
    }
  });

  it("keeps a formula with blank lines in it in one piece", () => {
    const text = "Before.\n\n$$\na = b\n\nc = d\n$$\n\nAfter.";
    expectSameAsWhole(text);
    expect(markdownBlocks(text)).toHaveLength(3);
    expect(markdownBlocks("> $$\n> a\n>\n> b\n> $$\n\nAfter")).toHaveLength(2);
  });

  it("tells a formula that is still arriving from a finished one", () => {
    const at = (source: string) => ({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: source.length },
    });
    for (const [source, closed] of [
      ["$$\na", false],
      ["$$\na\n$$", true],
      ["> $$\n> a\n> $$", true],
      ["```math\na", false],
      ["```math\na\n```", true],
    ] as const)
      expect(mathClosed(source, at(source))).toBe(closed);
  });
});
