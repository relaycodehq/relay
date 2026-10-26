import { describe, expect, it } from "vitest";
import type { LspSymbol } from "../../../../shared/language-servers";
import { codeAuthor, usagesLabel, visionDeclarations } from "./vision-lines";

const symbol = (name: string, kind: LspSymbol["kind"], line: number, container?: string): LspSymbol => ({
  name,
  kind,
  path: "a.ts",
  line,
  character: 2,
  endLine: line + 3,
  ...(container ? { container } : {}),
});

describe("visionDeclarations", () => {
  it("hints over types and callables, not what's inside a body", () => {
    const shown = visionDeclarations([
      symbol("Store", "class", 4),
      symbol("constructor", "constructor", 6, "Store"),
      symbol("cache", "property", 5, "Store"),
      symbol("read", "method", 10, "Store"),
      symbol("helper", "function", 12, "read"),
      symbol("useEffect() callback", "function", 14, "View"),
      symbol("View", "function", 1),
    ]);
    expect(shown.map((d) => d.name)).toEqual(["View", "Store", "constructor", "read"]);
  });

  it("tells a container from another symbol of its name", () => {
    const shown = visionDeclarations([
      symbol("Panel", "class", 1),
      symbol("render", "method", 2, "Panel"),
      symbol("Panel", "function", 20),
    ]);
    expect(shown.map((d) => d.name)).toEqual(["Panel", "render", "Panel"]);
  });
});

describe("codeAuthor", () => {
  const authors = { authors: ["ada", "bo", "cy"], lines: [0, 0, 1, 0, 2] };

  it("names who wrote most of the lines and counts the others", () => {
    expect(codeAuthor(authors, [1, 2, 3, 4, 5])).toBe("ada +2");
    expect(codeAuthor(authors, [3])).toBe("bo");
  });

  it("marks code with edits not committed yet, as PhpStorm does", () => {
    expect(codeAuthor(authors, [undefined, 3, undefined])).toBe("bo *");
    expect(codeAuthor(authors, [undefined, undefined])).toBe("new *");
    expect(codeAuthor(authors, [])).toBeUndefined();
  });
});

describe("usagesLabel", () => {
  it("reads like PhpStorm's", () => {
    expect([undefined, 0, 1, 7].map(usagesLabel)).toEqual(["Show usages", "no usages", "1 usage", "7 usages"]);
  });
});
