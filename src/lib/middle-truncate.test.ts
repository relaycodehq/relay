import { describe, expect, it } from "vitest";
import { fitMiddle, middleSplit } from "./middle-truncate";

// Every character one unit wide, so widths read as character counts.
const chars = (text: string) => text.length;

describe("fitMiddle", () => {
  const branch = "relay/i-have-this-idea-that-is-really-cool-i";
  const path = "src/features/changes/ChangesPane.tsx";

  it("leaves text that fits alone", () => {
    expect(fitMiddle(path, "path", path.length, chars)).toBe(path);
  });

  it("drops the middle, keeping the tail whole", () => {
    expect(fitMiddle(branch, "branch", 34, chars)).toBe(
      "relay/i-have-this-i…-really-cool-i",
    );
    expect(fitMiddle(path, "path", 28, chars)).toBe(
      "src/feature…/ChangesPane.tsx",
    );
  });

  it("fills the width exactly", () => {
    for (let width = 18; width < path.length; width++)
      expect(fitMiddle(path, "path", width, chars).length).toBeLessThanOrEqual(
        width,
      );
    expect(fitMiddle(path, "path", 20, chars)).toHaveLength(20);
  });

  it("doesn't leave a space before the ellipsis", () => {
    expect(fitMiddle("my folder/file.ts", "path", 12, chars)).toBe(
      "my…/file.ts",
    );
  });

  it("keeps the end of the tail once even the tail doesn't fit", () => {
    expect(fitMiddle(path, "path", 8, chars)).toBe("…ane.tsx");
    expect(fitMiddle(path, "path", 1, chars)).toBe("…");
  });
});

describe("middleSplit", () => {
  it("keeps a path's file name whole, with its slash", () => {
    expect(middleSplit("src/features/changes/ChangesPane.tsx", "path")).toEqual(
      ["src/features/changes", "/ChangesPane.tsx"],
    );
  });

  it("keeps a folder's own name when the path ends in a slash", () => {
    expect(middleSplit("src/features/", "path")).toEqual(["src", "/features/"]);
  });

  it("keeps a bare file name's extension", () => {
    expect(middleSplit("a-really-long-file-name.test.ts", "path")).toEqual([
      "a-really-long-file-name.test",
      ".ts",
    ]);
  });

  it("keeps the end of a bare name without a short extension", () => {
    expect(middleSplit("Makefile", "path")).toEqual(["Make", "file"]);
    expect(middleSplit("/etc", "path")).toEqual(["/e", "tc"]);
  });

  it("keeps a branch's last part when it is short", () => {
    expect(middleSplit("lubomir/feature/fix-sync", "branch")).toEqual([
      "lubomir/feature",
      "/fix-sync",
    ]);
  });

  it("keeps the last characters of a branch whose last part is long", () => {
    expect(
      middleSplit("relay/i-have-this-idea-that-is-really-cool-i", "branch"),
    ).toEqual(["relay/i-have-this-idea-that-is", "-really-cool-i"]);
  });

  it("keeps at most half of a short label as its tail", () => {
    expect(middleSplit("main", "branch")).toEqual(["ma", "in"]);
    expect(middleSplit("", "branch")).toEqual(["", ""]);
  });

  it("always joins back into the label", () => {
    for (const text of [
      "a/b/c.ts",
      "x",
      "feature/",
      "a.b.c.d",
      "worktrees/relay-a1b2c3",
    ])
      for (const kind of ["path", "branch"] as const)
        expect(middleSplit(text, kind).join("")).toBe(text);
  });
});
