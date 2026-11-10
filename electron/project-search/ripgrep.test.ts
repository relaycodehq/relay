import { describe, expect, it } from "vitest";
import { parseGlobs } from "./glob";
import { ripgrepArgs, parseRipgrepLine } from "./ripgrep";

const event = (over: object = {}) =>
  JSON.stringify({
    type: "match",
    data: {
      path: { text: "./src/a.ts" },
      lines: { text: "  const x = foo(1);\n" },
      line_number: 12,
      absolute_offset: 100,
      submatches: [{ match: { text: "foo" }, start: 12, end: 15 }],
      ...over,
    },
  });

describe("parseRipgrepLine", () => {
  it("reads a match: path without ./, trimmed preview, column in the line", () => {
    expect(parseRipgrepLine(event())).toEqual({
      path: "src/a.ts",
      matches: [
        {
          line: 12,
          column: 12,
          length: 3,
          preview: "const x = foo(1);",
          previewStart: 2,
        },
      ],
      more: false,
    });
  });

  it("turns UTF-8 byte offsets into UTF-16 columns", () => {
    // "é" is two bytes, "😀" four bytes and two UTF-16 units.
    const line = "é😀 foo\n";
    const found = parseRipgrepLine(
      event({
        lines: { text: line },
        submatches: [{ match: { text: "foo" }, start: 7, end: 10 }],
      }),
    );
    expect(found?.matches[0]).toMatchObject({ column: 4, length: 3 });
    expect(line.slice(4, 7)).toBe("foo");
  });

  it("keeps columns right across 1-, 2-, 3- and 4-byte characters", () => {
    // a, é (2 bytes), € (3), 😀 (4 bytes, 2 units): one foo after each.
    const line = "afoo é foo € foo 😀 foo 😀😀foo\n";
    const submatches: { start: number; end: number }[] = [];
    const bytes = Buffer.from(line);
    for (
      let at = bytes.indexOf("foo");
      at >= 0;
      at = bytes.indexOf("foo", at + 3)
    )
      submatches.push({ start: at, end: at + 3 });
    const found = parseRipgrepLine(
      event({ lines: { text: line }, submatches }),
    );
    const expected = [...line.matchAll(/foo/g)].map((m) => m.index);
    expect(found?.matches.map((m) => m.column)).toEqual(expected);
    expect(expected).toHaveLength(5);
    for (const m of found?.matches ?? [])
      expect(line.slice(m.column, m.column + m.length)).toBe("foo");
  });

  it("reads only as many matches as are still wanted, and says there were more", () => {
    const submatches = [0, 3, 6].map((start) => ({ start, end: start + 2 }));
    const lines = { text: "ab ab ab\n" };
    const some = parseRipgrepLine(event({ lines, submatches }), 2);
    expect(some?.matches.map((m) => m.column)).toEqual([0, 3]);
    expect(some?.more).toBe(true);
    const all = parseRipgrepLine(event({ lines, submatches }), 3);
    expect(all?.more).toBe(false);
    const none = parseRipgrepLine(event({ lines, submatches }), 0);
    expect(none).toMatchObject({ matches: [], more: true });
  });

  it("converts a long non-ASCII line with thousands of matches quickly", () => {
    const unit = '{"id":123,"name":"abcdéf"},';
    const text = unit.repeat(11_000);
    const bytes = Buffer.from(text);
    const submatches: { start: number; end: number }[] = [];
    for (let i = 0; i < bytes.length; i++)
      if (bytes[i] === 0x65) submatches.push({ start: i, end: i + 1 });
    expect(submatches.length).toBeGreaterThan(10_000);
    const raw = event({ lines: { text: text + "\n" }, submatches });
    const started = Date.now();
    const found = parseRipgrepLine(raw);
    // Decoding the line again for every offset took ~5s here.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(found?.matches).toHaveLength(submatches.length);
    const last = found?.matches.at(-1);
    expect(text.slice(last?.column, (last?.column ?? 0) + 1)).toBe("e");
  });

  it("gives every match in a line", () => {
    const found = parseRipgrepLine(
      event({
        lines: { text: "ab ab\n" },
        submatches: [
          { match: { text: "ab" }, start: 0, end: 2 },
          { match: { text: "ab" }, start: 3, end: 5 },
        ],
      }),
    );
    expect(found?.matches.map((m) => m.column)).toEqual([0, 3]);
  });

  it("skips other events, empty matches, and names or lines that are not text", () => {
    expect(
      parseRipgrepLine(JSON.stringify({ type: "begin", data: {} })),
    ).toBeNull();
    expect(parseRipgrepLine("not json")).toBeNull();
    expect(
      parseRipgrepLine(event({ submatches: [{ start: 3, end: 3 }] })),
    ).toBeNull();
    expect(parseRipgrepLine(event({ path: { bytes: "AAAA" } }))).toBeNull();
    expect(parseRipgrepLine(event({ lines: { bytes: "AAAA" } }))).toBeNull();
  });

  it("reads Windows separators as slashes", () => {
    expect(
      parseRipgrepLine(event({ path: { text: ".\\src\\a.ts" } }))?.path,
    ).toBe("src/a.ts");
  });
});

describe("ripgrepArgs", () => {
  const query = {
    pattern: "-v",
    regex: false,
    caseSensitive: true,
    wholeWord: true,
  };

  it("searches hidden files but not .git, and passes the pattern safely", () => {
    const args = ripgrepArgs(query, parseGlobs(), false);
    expect(args).toContain("--hidden");
    expect(args.join(" ")).toContain("--glob !.git");
    expect(args).toContain("--case-sensitive");
    expect(args).toContain("--word-regexp");
    expect(args).toContain("--fixed-strings");
    expect(args.slice(-3)).toEqual(["-e", "-v", "."]);
  });

  it("leaves out node_modules only where Git cannot say", () => {
    expect(ripgrepArgs(query, parseGlobs(), true).join(" ")).toContain(
      "!node_modules",
    );
    expect(ripgrepArgs(query, parseGlobs(), false).join(" ")).not.toContain(
      "node_modules",
    );
  });

  it("is a regex, case-insensitive, when asked", () => {
    const args = ripgrepArgs(
      { ...query, regex: true, caseSensitive: false, wholeWord: false },
      parseGlobs("*.ts"),
      false,
    );
    expect(args).toContain("--ignore-case");
    expect(args).not.toContain("--fixed-strings");
    expect(args).not.toContain("--word-regexp");
    // ripgrep's globs override .gitignore, so the include is left to the caller.
    expect(args.join(" ")).not.toContain("*.ts");
  });
});
