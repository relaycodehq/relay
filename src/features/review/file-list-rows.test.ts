import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../../../shared/types";
import type { ChangeGroup } from "../../../shared/triage";
import { foldedPaths, listRows, rowKey } from "./file-list-rows";

const file = (filename: string) =>
  ({ filename, status: "modified" }) as ChangedFile;

const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map(file);

const group = {
  id: "g",
  name: "Renames",
  description: "",
  paths: ["a.ts", "b.ts"],
} as ChangeGroup;

const keys = (rows: ReturnType<typeof listRows>) => rows.map(rowKey);

describe("listRows", () => {
  it("folds a complete group and viewed files under Viewed", () => {
    const folded = foldedPaths(files, [group], (p) => p !== "c.ts");
    expect([...folded].sort()).toEqual(["a.ts", "b.ts", "d.ts"]);
    const rows = listRows({
      files,
      groups: [group],
      folded,
      filter: "",
      open: new Set(),
      viewedOpen: false,
    });
    expect(keys(rows)).toEqual(["individual-label", "c.ts", "viewed-fold"]);
    expect(rows.at(-1)).toEqual({ type: "fold", count: 3 });
  });

  it("shows everything a filter matches, with groups open", () => {
    const rows = listRows({
      files,
      groups: [group],
      folded: new Set(["a.ts", "b.ts"]),
      filter: "A.TS",
      open: new Set(),
      viewedOpen: false,
    });
    expect(keys(rows)).toEqual(["viewed-fold", "g", "a.ts"]);
  });

  it("lists files plainly without groups", () => {
    const rows = listRows({
      files,
      groups: null,
      folded: new Set(["b.ts"]),
      filter: "",
      open: new Set(),
      viewedOpen: true,
    });
    expect(keys(rows)).toEqual(["a.ts", "c.ts", "d.ts", "viewed-fold", "b.ts"]);
  });
});
