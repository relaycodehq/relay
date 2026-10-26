import { expect, it } from "vitest";
import { passCoverage } from "../../../../shared/review-passes";
import {
  changeTree,
  filesByPass,
  moveToPass,
  passesFrom,
  runnablePasses,
  treeRows,
} from "./pass-tree";

const file = (path: string, additions = 10) => ({
  path,
  additions,
  deletions: 0,
});

const files = [
  file("src/app.ts"),
  file("src/editor/view.ts"),
  file("src/editor/gutter.ts"),
  file("electron/main.ts"),
  file("android/app/src/main/java/Thread.kt"),
  file("package-lock.json", 900),
];

it("moves a folder out of the pass that names a folder above it", () => {
  const top = changeTree(files);
  const byPass = filesByPass([["src/"], ["electron/", "android/"]], top);
  const moved = moveToPass(byPass, ["src/editor/view.ts", "src/editor/gutter.ts"], 1);
  const passes = passesFrom(moved, top);
  expect(passes).toEqual([["src/app.ts"], ["android/", "electron/", "src/editor/"]]);
  // What the engine reviews follows: nothing lost, nothing twice.
  const coverage = passCoverage(passes, files);
  expect(coverage.passes.map((p) => p.files)).toEqual([1, 4]);
  expect(coverage.missed).toEqual([]);
});

it("keeps a pass a move emptied, so the others keep their numbers", () => {
  const top = changeTree(files);
  const byPass = filesByPass([["src/"], ["electron/"], ["android/"]], top);
  const passes = passesFrom(moveToPass(byPass, ["electron/main.ts"], 2), top);
  expect(passes).toEqual([["src/"], [], ["android/", "electron/"]]);
  expect(filesByPass(passes, top)[1]).toEqual([]);
  // The review itself runs only the passes that hold something.
  expect(runnablePasses(passes)).toEqual([["src/"], ["android/", "electron/"]]);
  expect(runnablePasses([["src/", "electron/", "android/"], []])).toEqual([]);
});

it("shows a folder holding one folder as one row, and opens a folder split across passes", () => {
  const top = changeTree(files);
  const byPass = filesByPass([["src/", "electron/", "android/"], ["src/editor/"]], top);
  const rows = treeRows(top, byPass, {});
  expect(rows.map((r) => [r.label, r.depth])).toEqual([
    ["android/…/main/java/", 0],
    ["electron/", 0],
    ["src/", 0],
    ["editor/", 1],
    ["app.ts", 1],
  ]);
  // Closed by hand, it stays closed.
  expect(treeRows(top, byPass, { "src/": false }).map((r) => r.label)).toEqual([
    "android/…/main/java/",
    "electron/",
    "src/",
  ]);
});
