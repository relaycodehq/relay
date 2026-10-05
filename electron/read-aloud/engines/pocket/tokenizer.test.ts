import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SentencePiece } from "./tokenizer";

// Pocket TTS's english_2026-04 tokenizer.model (Kyutai, CC BY 4.0); the ids
// below come from the Python sentencepiece package encoding the same text.
const tokenizer = new SentencePiece(
  readFileSync(join(__dirname, "tokenizer.test.model")),
);

const reference: [text: string, ids: number[]][] = [
  ["Hello world!", [2994, 578, 682]],
  [
    "Done. Typecheck passes.",
    [1201, 336, 263, 602, 327, 777, 916, 603, 823, 371, 263],
  ],
  // Spaces kept as they are, control characters through byte pieces.
  [
    "  leading   spaces\nand newlines\r\n  ",
    [
      260, 260, 893, 273, 260, 260, 947, 261, 14, 1096, 514, 994, 261, 17, 14,
      260, 260,
    ],
  ],
  // Characters with no piece fall back to their UTF-8 bytes.
  [
    "日本語 and emoji 😅 mixed with ümlauts",
    [
      260, 234, 155, 169, 234, 160, 176, 236, 174, 162, 269, 1574, 3033, 260,
      244, 163, 156, 137, 1833, 278, 291, 260, 3252, 283, 541, 805, 261,
    ],
  ],
  ["…", [260, 230, 132, 170]],
  [
    "C'est l'été, ça va très bien.",
    [
      444, 264, 552, 1041, 264, 745, 274, 745, 262, 260, 2467, 362, 1283, 991,
      3208, 261, 1116, 439, 263,
    ],
  ],
];

it.each(reference)("encodes %j as sentencepiece does", (text, ids) => {
  expect(tokenizer.encode(text)).toEqual(ids);
});

it.each(reference)("decodes the ids of %j back to the text", (text, ids) => {
  expect(tokenizer.decode(ids)).toBe(text);
});

it("marks where words start, and gives bytes no text", () => {
  const [hello, world, bang] = tokenizer.encode("Hello world!");
  expect([
    tokenizer.piece(hello),
    tokenizer.piece(world),
    tokenizer.piece(bang),
  ]).toEqual(["▁Hello", "▁world", "!"]);
  expect(tokenizer.piece(tokenizer.encode("…")[1])).toBe("");
});
