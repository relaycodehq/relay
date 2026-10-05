import { describe, expect, it } from "vitest";
import {
  chunkText,
  endsSentence,
  preprocess,
  speechChunks,
  spellVersions,
  textIds,
  type SupertonicLanguage,
} from "./text";

// Outputs of _preprocessText and chunkText in supertone-inc/supertonic
// nodejs/helper.js (1e9799e), recorded by running it on these inputs.
const preprocessed: [string, SupertonicLanguage, string][] = [
  ["Done. Typecheck passes.", "en", "<en>Done. Typecheck passes.</en>"],
  [
    "I found the bug in turn-run.ts: when the second request finishes before the first",
    "en",
    "<en>I found the bug in turn-run.ts: when the second request finishes before the first.</en>",
  ],
  [
    "“Smart quotes” and ‘single’ ones — with dashes – everywhere",
    "en",
    "<en>\"Smart quotes\" and'single' ones - with dashes - everywhere.</en>",
  ],
  [
    "Use foo_bar/baz [x] | y # z → done ← back",
    "en",
    "<en>Use foo bar baz x y z done back.</en>",
  ],
  [
    "Email me @ work, e.g., tomorrow; i.e., soon",
    "en",
    "<en>Email me at work, for example, tomorrow; that is, soon.</en>",
  ],
  [
    "Spaces , before . punctuation ! really ? yes ; ok : fine",
    "en",
    "<en>Spaces, before. punctuation! really? yes; ok: fine.</en>",
  ],
  ["Hello 😀 world 🚀 ☀ ✂", "en", "<en>Hello world.</en>"],
  [
    "Ahoj, všetko je hotové a testy prechádzajú.",
    "sk",
    "<sk>Ahoj, všetko je hotové a testy prechádzajú.</sk>",
  ],
  [
    "Ahoj, všechno je hotové a testy procházejí",
    "cs",
    "<cs>Ahoj, všechno je hotové a testy procházejí.</cs>",
  ],
  ["ﬁne ①   full-width ＡＢＣ", "en", "<en>fine 1 full-width ABC.</en>"],
  [
    "Heart ♥ star ☆ copyright © back\\slash",
    "en",
    "<en>Heart star copyright backslash.</en>",
  ],
  ["He said \"\"hi\"\" and ''bye''", "en", "<en>He said \"hi\" and'bye'</en>"],
  ['Ends with a quote"', "en", '<en>Ends with a quote"</en>'],
  ["Ends with an ellipsis…", "en", "<en>Ends with an ellipsis...</en>"],
  ["Hi there", "na", "<na>Hi there.</na>"],
  ["Привет, мир", "ru", "<ru>Привет, мир.</ru>"],
];

const chunked: [string, number, string[]][] = [
  [
    "Mr. Smith met Dr. Jones at 5 p.m. on Baker St. yesterday. Then they left.",
    1,
    [
      "Mr. Smith met Dr. Jones at 5 p.m.",
      "on Baker St. yesterday.",
      "Then they left.",
    ],
  ],
  [
    "Mr. Smith met Dr. Jones at 5 p.m. on Baker St. yesterday. Then they left.",
    40,
    [
      "Mr. Smith met Dr. Jones at 5 p.m.",
      "on Baker St. yesterday. Then they left.",
    ],
  ],
  [
    "A. B. Charles went home. It was late! Was it? Yes.",
    1,
    ["A. B. Charles went home.", "It was late!", "Was it?", "Yes."],
  ],
  [
    "A. B. Charles went home. It was late! Was it? Yes.",
    40,
    ["A. B. Charles went home. It was late!", "Was it? Yes."],
  ],
  [
    "Use e.g. this one, i.e. the first. Or etc. and so on.",
    1,
    ["Use e.g. this one, i.e. the first.", "Or etc. and so on."],
  ],
  [
    "Para one line one.\nstill para one.\n\n\nPara two.",
    1,
    ["Para one line one.", "still para one.", "Para two."],
  ],
  [
    "Para one line one.\nstill para one.\n\n\nPara two.",
    40,
    ["Para one line one. still para one.", "Para two."],
  ],
  [
    "First sentence. Second one! Third? Fourth.",
    40,
    ["First sentence. Second one! Third?", "Fourth."],
  ],
];

describe("matches the reference implementation", () => {
  it.each(preprocessed)("normalizes %j", (text, lang, expected) => {
    expect(preprocess(text, lang)).toBe(expected.normalize("NFKD"));
  });

  it.each(chunked)("chunks %j at %i characters", (text, max, expected) => {
    expect(chunkText(text, max)).toEqual(expected);
  });
});

it("indexes UTF-16 code units and leaves out characters the model has no id for", () => {
  const indexer = new Int32Array(65536).fill(-1);
  indexer["a".charCodeAt(0)] = 1;
  indexer["s".charCodeAt(0)] = 2;
  indexer["̌".charCodeAt(0)] = 3; // the caron NFKD splits off "š"
  expect(textIds("aš€a".normalize("NFKD"), indexer)).toEqual([1, 2, 3, 1]);
});

describe("speech chunks", () => {
  const answer =
    "I found the bug in turn-run.ts: when the second request finishes before the first, the old one overwrites the newer state. I added a request token so stale answers are dropped, and the three tests in project-chats pass now. Version 0.7.1 can ship once you've checked it on the phone.";

  it("plays the first clause of a long opening sentence on its own", () => {
    const [first, second] = speechChunks(answer, "en");
    expect(first).toBe("I found the bug in turn-run.ts:");
    expect(second.startsWith("when the second request")).toBe(true);
  });

  it("keeps a short opening sentence whole", () => {
    expect(speechChunks("Done. Typecheck passes.", "en")).toEqual([
      "Done. Typecheck passes.",
    ]);
  });

  it("lets each chunk grow to at most twice the one before, and loses no words", () => {
    const long = Array.from(
      { length: 30 },
      (_, i) => `Sentence number ${i} says a few words.`,
    ).join(" ");
    const chunks = speechChunks(long, "en");
    expect(chunks[0].length).toBeLessThanOrEqual(100);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].length).toBeLessThanOrEqual(
        Math.max(100, chunks[i - 1].length * 2),
      );
      expect(chunks[i].length).toBeLessThanOrEqual(300);
    }
    expect(chunks.join(" ")).toBe(long);
  });

  it("cuts a sentence longer than a chunk at clause marks, then spaces", () => {
    const sentence =
      Array.from({ length: 40 }, (_, i) => `clause ${i}`).join(", ") + ".";
    const chunks = speechChunks(`${sentence}\n\nNext paragraph.`, "ko");
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
    expect(chunks.slice(0, -1).join(" ")).toBe(sentence);
    expect(chunks.at(-1)).toBe("Next paragraph.");
  });

  it("tells chunks that end a sentence from ones cut mid-sentence", () => {
    expect(endsSentence("It was late!")).toBe(true);
    expect(endsSentence("He said “stop.”")).toBe(true);
    expect(endsSentence("I found the bug in turn-run.ts:")).toBe(false);
    expect(endsSentence("clause 3,")).toBe(false);
  });
});

it("spells out dotted versions and leaves decimals alone", () => {
  expect(
    spellVersions("Version 0.7.1 can ship, then v1.24.305 and 10.07.2026."),
  ).toBe(
    "Version zero point seven point one can ship, then one point twenty-four point three hundred five and ten point zero seven point two zero two six.",
  );
  expect(spellVersions("It took 3.5 seconds, see turn-run.ts.")).toBe(
    "It took 3.5 seconds, see turn-run.ts.",
  );
});
