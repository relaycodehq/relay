import { describe, expect, it } from "vitest";
import { bracketSpacedImagePaths } from "./answer-images";
import { markdownImages } from "./markdown-images";

const OLD_IMAGE =
  /!\[[^\]\n]*\]\(\s*(?:<([^<>\n]+)>|([^\s<>()]+)|([^\s<>()][^<>()\n]*?\.(?:png|jpe?g|gif|webp|mp4|m4v|webm|mov)))(?:\s+["'][^"'\n]*["'])?\s*\)/gi;

const byRegex = (text: string) =>
  [...text.matchAll(OLD_IMAGE)].map((m) => ({
    index: m.index,
    text: m[0],
    bracketed: m[1],
    bare: m[2],
    spaced: m[3],
  }));

const PIECES = [
  "![",
  "](",
  "]",
  "(",
  ")",
  " ",
  "\n",
  "<",
  ">",
  "a",
  ".PNG",
  '"t"',
  "![a](b c.png)",
];

function randomText(seed: number): string {
  let state = seed,
    text = "";
  for (let i = 0; i < seed % 30; i++) {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    text += PIECES[state % PIECES.length];
  }
  return text;
}

const oldBracketSpaced = (text: string) =>
  text.replace(OLD_IMAGE, (image: string, _b, _p, spaced?: string) => {
    if (!spaced) return image;
    const at = image.indexOf(spaced, image.indexOf("]("));
    return `${image.slice(0, at)}<${spaced}>${image.slice(at + spaced.length)}`;
  });

describe("markdownImages", () => {
  it("finds what the old expression found", () => {
    let found = 0;
    for (let seed = 0; seed < 20_000; seed++) {
      const text = randomText(seed);
      const images = markdownImages(text);
      expect(images, JSON.stringify(text)).toEqual(byRegex(text));
      found += images.length;
      expect(bracketSpacedImagePaths(text)).toBe(
        text.split("\n").map(oldBracketSpaced).join("\n"),
      );
    }
    expect(found).toBeGreaterThan(100);
  });

  it("reads a line of unclosed openers in linear time", () => {
    const line = "![".repeat(10_000);
    const started = performance.now();
    bracketSpacedImagePaths(line);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
