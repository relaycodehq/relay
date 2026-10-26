import { describe, expect, it } from "vitest";
import { hitsIn, replaceInText, searchRegExp } from "./matcher";
import { matchPreview } from "./preview";

const query = (pattern: string, over = {}) => ({
  pattern,
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  ...over,
});

describe("searchRegExp", () => {
  it("takes a plain query literally", () => {
    const re = searchRegExp(query("a.b(c)"));
    expect(hitsIn(re, "xa.b(c)x a-b(c)")).toEqual([{ index: 1, length: 6 }]);
  });

  it("ignores case unless asked not to", () => {
    expect(hitsIn(searchRegExp(query("todo")), "TODO Todo")).toHaveLength(2);
    expect(
      hitsIn(searchRegExp(query("todo", { caseSensitive: true })), "TODO Todo"),
    ).toHaveLength(0);
  });

  it("matches whole words only, also around symbols", () => {
    const re = searchRegExp(query("use", { wholeWord: true }));
    expect(
      hitsIn(re, "use users reuse use_x (use) use").map((h) => h.index),
    ).toEqual([0, 23, 28]);
    const call = searchRegExp(query("foo(", { wholeWord: true }));
    expect(hitsIn(call, "foo( 1) xfoo( 2) foo(3)").map((h) => h.index)).toEqual(
      [0],
    );
  });

  it("counts an accented letter as part of a word", () => {
    const re = searchRegExp(query("cafe", { wholeWord: true }));
    expect(hitsIn(re, "cafe café_cafe")).toHaveLength(1);
    const accent = searchRegExp(query("é", { wholeWord: true }));
    expect(hitsIn(accent, "é eé")).toHaveLength(1);
  });

  it("keeps a plain query with a dash in Unicode mode", () => {
    const re = searchRegExp(query("a-b", { wholeWord: true }));
    expect(hitsIn(re, "a-bé a-b")).toEqual([{ index: 5, length: 3 }]);
  });

  it("runs a regex, and ignores empty matches", () => {
    const re = searchRegExp(query("a*", { regex: true }));
    expect(hitsIn(re, "baab")).toEqual([{ index: 1, length: 2 }]);
    expect(hitsIn(searchRegExp(query("^", { regex: true })), "abc")).toEqual(
      [],
    );
  });

  it("steps over an emoji after an empty match instead of looping", () => {
    const re = searchRegExp(query("^|foo", { regex: true }));
    expect(hitsIn(re, "\u{1F600} foo")).toEqual([{ index: 3, length: 3 }]);
  });

  it("takes escapes unicode mode refuses", () => {
    const re = searchRegExp(query("a\\-b", { regex: true }));
    expect(hitsIn(re, "a-b")).toHaveLength(1);
  });

  it("says what is wrong with a pattern", () => {
    expect(() => searchRegExp(query("(", { regex: true }))).toThrow(
      /^Invalid regular expression: .*\.$/,
    );
  });
});

describe("replaceInText", () => {
  const replace = (
    text: string,
    pattern: string,
    replacement: string,
    over = {},
  ) => {
    const q = query(pattern, over);
    return replaceInText(searchRegExp(q), text, replacement, q.regex);
  };

  it("puts a plain replacement in as typed, dollar signs included", () => {
    expect(replace("a a", "a", "$1&")).toEqual({ text: "$1& $1&", count: 2 });
  });

  it("expands capture groups for a regex", () => {
    expect(
      replace("get(x) get(y)", "get\\((\\w)\\)", "read<$1>", { regex: true }),
    ).toEqual({ text: "read<x> read<y>", count: 2 });
    expect(
      replace("2024-05", "(?<y>\\d+)-(?<m>\\d+)", "$<m>/$<y> $& $$", {
        regex: true,
      }).text,
    ).toBe("05/2024 2024-05 $");
  });

  it("reads $10 as $1 and a zero when there is one group", () => {
    expect(replace("ab", "(a)b", "[$10]", { regex: true }).text).toBe("[a0]");
  });

  it("keeps line endings, a missing last newline, and a BOM", () => {
    const text = "﻿foo\r\nbar foo\nfoo";
    expect(replace(text, "foo", "x").text).toBe("﻿x\r\nbar x\nx");
  });

  it("matches per line, so ^ and $ mean the line", () => {
    expect(
      replace("a\nb\na", "^a$", "z", { regex: true, caseSensitive: true }),
    ).toEqual({ text: "z\nb\nz", count: 2 });
  });

  it("replaces next to an emoji after an empty match", () => {
    expect(replace("\u{1F600} foo", "^|foo", "x", { regex: true })).toEqual({
      text: "\u{1F600} x",
      count: 1,
    });
  });

  it("counts nothing for text without a match", () => {
    expect(replace("none", "x", "y")).toEqual({ text: "none", count: 0 });
  });
});

describe("matchPreview", () => {
  it("drops the indentation and the carriage return", () => {
    expect(matchPreview("    return foo;\r", 7, 11, 3)).toEqual({
      line: 7,
      column: 11,
      length: 3,
      preview: "return foo;",
      previewStart: 4,
    });
  });

  it("windows a long line around the match", () => {
    const line = "x".repeat(1000) + "NEEDLE" + "y".repeat(1000);
    const m = matchPreview(line, 1, 1000, 6);
    expect(m.preview.length).toBeLessThan(300);
    expect(m.preview.slice(1000 - m.previewStart, 1006 - m.previewStart)).toBe(
      "NEEDLE",
    );
  });

  it("keeps a match near the start in its line", () => {
    const m = matchPreview("foo " + "z".repeat(500), 1, 0, 3);
    expect(m.previewStart).toBe(0);
    expect(m.preview.startsWith("foo ")).toBe(true);
  });
});
