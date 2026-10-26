import { describe, expect, it } from "vitest";
import type {
  ProjectSearchFile,
  ProjectSearchMatch,
} from "../../../shared/project-search";
import { buildRows, replaceScope, summary } from "./search-model";

const m = (
  line: number,
  column: number,
  over: Partial<ProjectSearchMatch> = {},
): ProjectSearchMatch => ({
  line,
  column,
  length: 3,
  preview: "foo foo",
  previewStart: 0,
  ...over,
});

const file = (
  path: string,
  matches: ProjectSearchMatch[],
): ProjectSearchFile => ({
  path,
  version: "v",
  matches,
});

const files = [
  file("a.ts", [m(1, 0), m(1, 4), m(3, 0)]),
  file("b.ts", [m(9, 0)]),
];

describe("buildRows", () => {
  it("lists a header per file and a row per matching line", () => {
    const rows = buildRows(files, new Set(), new Set());
    expect(
      rows.map((r) => [r.kind, r.kind === "file" ? r.count : r.first.line]),
    ).toEqual([
      ["file", 3],
      ["line", 1],
      ["line", 3],
      ["file", 1],
      ["line", 9],
    ]);
  });

  it("shares a row between matches on one line, as ranges in its preview", () => {
    const rows = buildRows(files, new Set(), new Set());
    expect(rows[1].kind === "line" && rows[1].hits).toEqual([
      { start: 0, length: 3 },
      { start: 4, length: 3 },
    ]);
  });

  it("keeps matches of a long line apart when their previews are windowed differently", () => {
    const far = file("c.ts", [
      m(1, 0, { previewStart: 0 }),
      m(1, 900, { previewStart: 860 }),
    ]);
    expect(buildRows([far], new Set(), new Set())).toHaveLength(3);
  });

  it("hides the lines of a collapsed file and marks excluded ones", () => {
    const rows = buildRows(files, new Set(["a.ts"]), new Set(["b.ts"]));
    expect(rows.map((r) => r.kind)).toEqual(["file", "file", "line"]);
    expect(rows.map((r) => r.excluded)).toEqual([false, true, true]);
    expect(rows[0].kind === "file" && rows[0].collapsed).toBe(true);
  });
});

describe("replaceScope", () => {
  it("counts what is left after exclusions", () => {
    const scope = replaceScope(files, new Set(["a.ts"]));
    expect(scope.files.map((f) => f.path)).toEqual(["b.ts"]);
    expect(scope.matches).toBe(1);
  });
});

describe("summary", () => {
  it("counts matches and files, with a plus past the cap", () => {
    expect(summary(files, false)).toBe("4 matches in 2 files");
    expect(summary([files[1]], false)).toBe("1 match in 1 file");
    expect(summary(files, true)).toBe("4+ matches in 2+ files");
  });
});
