import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  quoteMarkdown,
  selectionQuote,
  quoteLabel,
  unquote,
} from "../../src/lib/composer-quotes";
import { Quote } from "../../src/components/ComposerPromptInput";
import { promptContent } from "../../src/lib/prompt-content";
import { promptText } from "../../src/lib/prompt-text";

const schema = getSchema([
  StarterKit.configure({
    heading: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    codeBlock: false,
    horizontalRule: false,
    bold: false,
    italic: false,
    strike: false,
    code: false,
    link: false,
    underline: false,
  }),
  Quote,
]);
const roundTrip = (draft: string, quotes: string[]) =>
  promptText(schema.nodeFromJSON(promptContent(draft, {}, quotes)));

it("sends a quote as a blockquote followed by a blank line", () => {
  expect(quoteMarkdown("one\ntwo")).toBe("> one\n> two\n\n");
  expect(unquote("> one\n> two\n\n")).toBe("one\ntwo");
  expect(unquote(">\n> \n> x")).toBe("\n\nx");
});

it("tidies a browser selection without touching indentation", () => {
  expect(selectionQuote("  code()  \r\n\n\n\nnext line \n")).toBe(
    "  code()\n\nnext line",
  );
  expect(selectionQuote(" \n ")).toBe("");
  expect(quoteLabel("That matches\nthe carve-out for a binary", 20)).toBe(
    "That matches the ca…",
  );
  expect(quoteLabel("short", 20)).toBe("short");
});

it("restores registered quotes as pills and leaves hand-typed blockquotes alone", () => {
  const draft = "> a\n> b\n\nWhy?";
  const pills = promptContent(draft, {}, ["a\nb"]).content![0].content!;
  expect(pills).toEqual([
    { type: "relayQuote", attrs: { text: "a\nb" } },
    { type: "text", text: "Why?" },
  ]);
  const typed = promptContent(draft, {}).content![0].content!;
  expect(typed.filter((n) => n.type === "relayQuote")).toHaveLength(0);
  expect(typed.filter((n) => n.type === "hardBreak")).toHaveLength(3);
  expect(promptContent("x > 5\n", {}, ["5"]).content![0].content).toEqual([
    { type: "text", text: "x > 5" },
    { type: "hardBreak" },
  ]);
});

it("round-trips quotes and line breaks through the editor document", () => {
  const quotes = ["one\ntwo", "first", "second", "only a quote", "later quote"];
  for (const draft of [
    "> one\n> two\n\nExplain this",
    "> first\n\n> second\n\n\nafter a break",
    "Explain\n\n> later quote\n\nplease",
  ])
    expect(roundTrip(draft, quotes)).toBe(draft);
  // A queued body comes back trimmed; the pill regains its blank line.
  expect(roundTrip("> only a quote", quotes)).toBe("> only a quote\n\n");
});

it("starts a quote after text on its own line without adding a line break", () => {
  const inline = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "relayQuote", attrs: { text: "first" } },
          { type: "text", text: "Compare with" },
          { type: "relayQuote", attrs: { text: "second" } },
          { type: "text", text: "please" },
        ],
      },
    ],
  });
  const draft = "> first\n\nCompare with\n> second\n\nplease";
  expect(promptText(inline)).toBe(draft);
  expect(promptContent(draft, {}, ["first", "second"])).toEqual(
    inline.toJSON(),
  );
  // Before the quote is registered it stays hand-typed text on its own line.
  expect(
    promptContent(draft, {}, ["first"]).content![0].content!.filter(
      (n) => n.type === "hardBreak",
    ),
  ).toHaveLength(3);
});
