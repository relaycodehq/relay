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
    expect(args.join(" ")).toContain("--glob *.ts --glob *.ts/**");
  });
});
