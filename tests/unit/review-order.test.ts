import { expect, it } from "vitest";
import { openGroups, reviewOrder } from "../../src/lib/review-order";

const file = (filename: string) => ({
  filename,
  status: "modified",
  additions: 1,
  deletions: 1,
  changes: 2,
});
const group = (id: string, paths: string[]) => ({
  id,
  name: id,
  description: "",
  paths,
});
const names = (files: { filename: string }[]) => files.map((f) => f.filename);

it("drops excluded files from groups, and groups left with fewer than two", () => {
  const groups = openGroups(
    [group("a", ["x", "y", "z"]), group("b", ["p", "q"])],
    new Set(["y", "q"]),
  );
  expect(groups.map((g) => [g.id, g.paths])).toEqual([["a", ["x", "z"]]]);
});

it("puts grouped files first in group order, then the rest in the repository's", () => {
  const files = ["a", "b", "c", "d", "e"].map(file);
  const groups = [group("g1", ["d", "b"]), group("g2", ["gone", "a"])];
  expect(names(reviewOrder(files, groups, false))).toEqual([
    "d",
    "b",
    "a",
    "c",
    "e",
  ]);
  expect(reviewOrder(files, groups, true)).toBe(files);
  expect(reviewOrder(files, [], false)).toBe(files);
});
