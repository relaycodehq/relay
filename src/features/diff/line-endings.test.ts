import { expect, it } from "vitest";
import { parseDiffFromFile } from "@pierre/diffs";
import { matchLineEndings } from "./line-endings";

const changed = (old: string, next: string) => {
  const diff = parseDiffFromFile(
    { name: "f.txt", contents: matchLineEndings(old, next).old },
    { name: "f.txt", contents: next },
  );
  return diff.hunks.reduce((sum, h) => sum + h.additionLines, 0);
};

it("shows only the edited line of a CRLF working file over an LF index", () => {
  expect(changed("one\ntwo\nthree\n", "one\r\nTWO\r\nthree\r\n")).toBe(1);
  expect(changed("one\r\ntwo\r\n", "one\nTWO\n")).toBe(1);
  expect(matchLineEndings("a\n", "a\r\n").eol).toBe("CRLF");
});

it("leaves sides alone when the endings agree or either side mixes them", () => {
  expect(matchLineEndings("a\nb\n", "a\nc\n")).toEqual({ old: "a\nb\n" });
  expect(matchLineEndings("a\r\nb\n", "a\r\nc\r\n")).toEqual({
    old: "a\r\nb\n",
  });
  expect(matchLineEndings("", "a\r\n")).toEqual({ old: "" });
});
