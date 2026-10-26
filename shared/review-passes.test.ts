import { expect, it } from "vitest";
import {
  covers,
  parsePasses,
  passCoverage,
  passesText,
  passPathspecs,
} from "./review-passes";

const file = (path: string, additions = 10) => ({
  path,
  additions,
  deletions: 0,
});

it("gives a path to the pass that names it most closely", () => {
  const passes = [["src/"], ["src/editor/", "!src/editor/old.ts"]];
  expect(covers(passes, 0, "src/app.ts")).toBe(true);
  expect(covers(passes, 0, "src/editor/view.ts")).toBe(false);
  expect(covers(passes, 1, "src/editor/view.ts")).toBe(true);
  // Left out of the closer pass, and not the other's either.
  expect(covers(passes, 1, "src/editor/old.ts")).toBe(false);
  expect(covers(passes, 0, "src/editor/old.ts")).toBe(false);
});

it("diffs a pass without what other passes and fixtures took", () => {
  const files = [
    file("src/app.ts"),
    file("src/editor/view.ts"),
    file("src/__fixtures__/trace.json", 1800),
    file("src/package-lock.json", 900),
  ];
  const passes = [["src/"], ["src/editor/"]];
  expect(passPathspecs(passes, 0, files)).toEqual([
    "src",
    ":(exclude)src/editor",
    ":(exclude)src/__fixtures__/trace.json",
    ":(exclude)src/package-lock.json",
  ]);
  // A fixture a pass names itself is read.
  expect(passPathspecs([["src/__fixtures__/trace.json"]], 0, files)).toEqual([
    "src/__fixtures__/trace.json",
  ]);
});

it("counts each pass's lines and what no pass covers", () => {
  const files = [
    file("src/app.ts", 30),
    file("lib/store.ts", 20),
    file("docs/notes.md", 5),
    file("src/__fixtures__/trace.json", 1800),
  ];
  const { passes, missed } = passCoverage([["src/"], ["lib/"]], files);
  expect(passes).toEqual([
    { files: 1, lines: 30 },
    { files: 1, lines: 20 },
  ]);
  expect(missed.map((f) => f.path)).toEqual(["docs/notes.md"]);
});

it("reads passes written one a line, quoting paths with spaces", () => {
  const passes = [["android/"], ["src/", "My Docs/", "!src/old.ts"]];
  const text = passesText(passes);
  expect(text).toBe('android/\nsrc/ "My Docs/" !src/old.ts');
  expect(parsePasses(`${text}\n\n   \n`)).toEqual(passes);
});
