import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareText, splitIntoChunks } from "./text";
import { SentencePiece } from "./tokenizer";

const tokenizer = new SentencePiece(
  readFileSync(join(__dirname, "tokenizer.test.model")),
);
// bundle.json's max_token_per_chunk for english_2026-04.
const maxTokens = 50;

describe("preparing text as Kyutai's reference does", () => {
  it.each([
    ["Hello world!", "Hello world!", 5],
    ["a", "A.", 5],
    [
      "  leading   spaces\nand newlines\r\n  ",
      "Leading  spaces and newlines.",
      5,
    ],
    ["One. Two! Three? Four... five", "One. Two! Three? Four... five.", 3],
    ["ends with a comma,", "Ends with a comma.", 5],
    ['He said "hi"', 'He said "hi".', 5],
    ['He said "hi,"', 'He said "hi."', 5],
    ["…", "…", 5],
    ["élan vital", "Élan vital.", 5],
  ])("%j becomes %j", (raw, text, framesAfterEos) => {
    expect(prepareText(raw)).toEqual({ text, framesAfterEos });
  });

  it("has nothing to say for blank text", () => {
    expect(prepareText(" \n ")).toBeNull();
  });
});

describe("splitting into chunks", () => {
  it("keeps sentences that fit together", () => {
    expect(
      splitIntoChunks(tokenizer, "Done. Typecheck passes.", maxTokens),
    ).toEqual(["Done. Typecheck passes."]);
  });

  it("packs whole sentences into chunks of at most the limit", () => {
    const answer =
      "I found the bug in turn-run.ts: when the second request finishes before the first, the old one overwrites the newer state. I added a request token so stale answers are dropped, and the three tests in project-chats pass now. Version 0.7.1 can ship once you've checked it on the phone.";
    const chunks = splitIntoChunks(tokenizer, answer, maxTokens);
    // Kyutai's reference splits after "turn-run." and reads "turn-run. ts".
    expect(chunks).toEqual([
      "I found the bug in turn-run.ts: when the second request finishes before the first, the old one overwrites the newer state.",
      "I added a request token so stale answers are dropped, and the three tests in project-chats pass now.",
      "Version 0.7.1 can ship once you've checked it on the phone.",
    ]);
    for (const chunk of chunks)
      expect(tokenizer.encode(chunk).length).toBeLessThanOrEqual(maxTokens);
  });

  it.each([
    "The value is 3.14159 and e.g. this one i.e. that.",
    "See https://example.com/path?query=1&b=2#frag now.",
    'It costs $3.50, right? "Yes," she said. (Really.) Okay…',
  ])("doesn't end a sentence inside a word: %j", (text) => {
    expect(splitIntoChunks(tokenizer, text, maxTokens)).toEqual([text]);
  });

  it("ends a sentence after a closing quote", () => {
    const limit = tokenizer.encode('He said "hi."').length;
    expect(
      splitIntoChunks(tokenizer, 'He said "hi." Then left.', limit),
    ).toEqual(['He said "hi."', "Then left."]);
  });

  it("splits an overlong sentence at its commas", () => {
    const text = `${"This is a long sentence, ".repeat(8)}and it ends here.`;
    expect(splitIntoChunks(tokenizer, text, maxTokens)).toEqual([
      "This is a long sentence, ".repeat(7).trim(),
      "This is a long sentence, and it ends here.",
    ]);
  });

  it("cuts a clause still over the limit between words, losing none", () => {
    const text = Array(80).fill("word").join(" ");
    const chunks = splitIntoChunks(tokenizer, text, maxTokens);
    expect(chunks.length).toBe(2);
    for (const chunk of chunks)
      expect(tokenizer.encode(chunk).length).toBeLessThanOrEqual(maxTokens);
    expect(chunks.join(" ")).toBe(`W${text.slice(1)}.`);
  });
});
