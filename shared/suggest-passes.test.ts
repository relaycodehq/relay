import { expect, it } from "vitest";
import { passCoverage, readLines } from "./review-passes";
import { suggestPasses } from "./suggest-passes";

/** `count` files of `lines` each in `folder`. */
const files = (folder: string, count: number, lines: number, ext = "ts") =>
  Array.from({ length: count }, (_, i) => ({
    path: `${folder}file${i}.${ext}`,
    additions: lines,
    deletions: 0,
  }));

it("keeps a change one pass reads well whole", () => {
  expect(suggestPasses(files("src/", 20, 100))).toEqual([]);
});

it("gives each language's code a pass, leaving fixtures out", () => {
  const change = [
    ...files("android/app/", 10, 200, "kt"),
    // Test data the size of the app's code doesn't make it bigger to read.
    ...files("android/app/src/test/resources/", 1, 1800, "json"),
    ...files("ios/App/", 10, 200, "swift"),
    ...files("src/", 15, 200),
    { path: "package.json", additions: 4, deletions: 1 },
  ];
  expect(suggestPasses(change)).toEqual([
    ["android/"],
    ["ios/"],
    ["package.json", "src/"],
  ]);
});

it("splits a big folder along its own, keeps a feature's folders together, and covers everything once", () => {
  const change = [
    ...files("electron/search/", 4, 150),
    ...files("src/features/editor/", 30, 150),
    ...files("src/features/editor/minimap/", 15, 150),
    ...files("src/features/files/", 25, 150),
    ...files("src/features/search/", 20, 150),
  ];
  const passes = suggestPasses(change);
  expect(passes.length).toBeGreaterThan(1);
  // The backend's search is all of electron/, so it goes with the search UI.
  const search = passes.find((p) => p.includes("electron/"));
  expect(search).toContain("src/features/search/");
  const { passes: covered, missed } = passCoverage(passes, change);
  expect(missed).toEqual([]);
  expect(covered.reduce((n, p) => n + p.lines, 0)).toBe(
    change.reduce((n, f) => n + readLines(f), 0),
  );
});
