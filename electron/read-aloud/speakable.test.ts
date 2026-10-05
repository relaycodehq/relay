import { describe, expect, it } from "vitest";
import {
  chunkLimit,
  codePlaceholder,
  firstChunkLimit,
  sentencesOf,
  speakableBlocks,
  speakableChunks,
  spokenInline,
} from "./speakable";

describe("speakableBlocks", () => {
  it("swaps fenced code for one short placeholder, closed or not", () => {
    const md = [
      "Run this:",
      "```ts",
      "const x = 1; // not read",
      "```",
      "Then this:",
      "~~~",
      "rm -rf build",
      "~~~",
      "And finally:",
      "````",
      "```",
      "nested fence stays inside",
      "````",
      "Unclosed:",
      "```",
      "never read",
    ].join("\n");
    expect(speakableBlocks(md)).toEqual([
      "Run this:",
      codePlaceholder,
      "Then this:",
      codePlaceholder,
      "And finally:",
      codePlaceholder,
      "Unclosed:",
      codePlaceholder,
    ]);
  });

  it("gives headings, list items and table rows their own sentence", () => {
    const md = [
      "## What changed",
      "- Fixed the race",
      "- [x] Added a test",
      "1. Then shipped it",
      "",
      "| File | Lines |",
      "| --- | ---: |",
      "| a.ts | 12 |",
      "",
      "---",
      "> Quoted line",
      "wrapped onto two",
    ].join("\n");
    expect(speakableBlocks(md)).toEqual([
      "What changed.",
      "Fixed the race.",
      "Added a test.",
      "Then shipped it.",
      "File, Lines.",
      "a.ts, 12.",
      "Quoted line wrapped onto two.",
    ]);
  });

  it("skips blocks with nothing to say", () => {
    expect(
      speakableBlocks("***\n\n[ref]: https://x.dev\n\n<!-- hi -->"),
    ).toEqual([]);
  });
});

describe("spokenInline", () => {
  it("reads inline code by its text, untouched by the symbol cleanup", () => {
    expect(spokenInline("Call `**not bold**` then `a->b`")).toBe(
      "Call **not bold** then a->b",
    );
  });

  it("says file names in code by name, with the extension spelled out", () => {
    expect(
      spokenInline(
        "Fixed `turn-run.ts`, `src/app/Main.tsx`, `package.json` and `README.md`.",
      ),
    ).toBe(
      "Fixed turn run dot T S, Main dot T S X, package dot json and README dot M D.",
    );
    expect(spokenInline("Run `npm test`, `a.b()` or `v0.7.1`.")).toBe(
      "Run npm test, a.b() or v0.7.1.",
    );
  });

  it("reads links and images by their text and bare URLs by their host", () => {
    expect(
      spokenInline(
        "See [the docs](https://x.dev/a) and ![a chart](c.png), or https://www.github.com/x/y.",
      ),
    ).toBe("See the docs and a chart, or github.com.");
    expect(spokenInline("<https://nodejs.org/api> has it")).toBe(
      "nodejs.org has it",
    );
  });

  it("drops emphasis and tags but keeps snake_case and lone stars", () => {
    expect(
      spokenInline(
        "**Bold**, *it*, _em_, ~~old~~ and <kbd>⌘</kbd> in my_var_name, 2 * 3",
      ),
    ).toBe("Bold, it, em, old and ⌘ in my_var_name, 2 * 3");
  });

  it("keeps escaped characters literal", () => {
    expect(spokenInline("a \\*literal\\* star")).toBe("a *literal* star");
  });
});

describe("sentencesOf", () => {
  it("does not cut abbreviations, decimals or file names", () => {
    expect(
      sentencesOf(
        "Use e.g. vitest 1.5 on app.ts. It works! Does it? Yes… mostly.",
      ),
    ).toEqual([
      "Use e.g. vitest 1.5 on app.ts.",
      "It works!",
      "Does it?",
      "Yes… mostly.",
    ]);
  });
});

describe("speakableChunks", () => {
  const long = Array.from(
    { length: 40 },
    (_, i) =>
      `Sentence number ${i} talks about the change, which touched several files across the app.`,
  ).join(" ");

  it("starts with a short chunk and keeps the rest within the limit", () => {
    const chunks = speakableChunks(long);
    expect(chunks[0].length).toBeLessThanOrEqual(firstChunkLimit);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(chunkLimit);
    // Several sentences share a chunk, so a long answer isn't hundreds of calls.
    expect(chunks.length).toBeLessThan(25);
  });

  it("loses no words when it cuts", () => {
    const words = (s: string) => s.split(/\s+/).filter(Boolean);
    const run = "word ".repeat(200).trim() + ".";
    for (const text of [long, run]) {
      expect(words(speakableChunks(text).join(" "))).toEqual(words(text));
    }
  });

  it("cuts an overlong first sentence at a clause, not mid-phrase", () => {
    const chunks = speakableChunks(
      "I went through the whole worker and the service it talks to, and the bug was in the idle timer that never got cleared.",
    );
    expect(chunks[0]).toBe(
      "I went through the whole worker and the service it talks to,",
    );
  });

  it("says nothing for an empty or code-free-of-words answer", () => {
    expect(speakableChunks("")).toEqual([]);
    expect(speakableChunks("---\n\n***")).toEqual([]);
  });
});
