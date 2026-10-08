import { expect, it } from "vitest";
import { changeKind } from "../../../shared/working-tree";
import {
  byFolder,
  changeSections,
  otherArea,
  parseSavedChanges,
  revealArea,
  settleSelection,
} from "./working-changes";

const change = (
  path: string,
  index: string,
  worktree: string,
  conflict = false,
) => ({
  path,
  index,
  worktree,
  conflict,
});

const partly = change("src/a.ts", "M", "M"),
  staged = change("src/b.ts", "A", " "),
  untracked = change("c.md", "?", "?"),
  conflicted = change("src/d.ts", "U", "U", true);

it("puts partly staged files in both lists and untracked ones in the working list", () => {
  const [index, working] = changeSections([
    partly,
    staged,
    untracked,
    conflicted,
  ]);
  expect(index.files).toEqual([partly, staged, conflicted]);
  expect(working.files).toEqual([partly, untracked, conflicted]);
  expect([index.kind, working.kind]).toEqual(["unstage", "stage"]);
});

it("groups files under their folder in the order the folders first appear", () => {
  const files = [
    change("src/a.ts", "M", " "),
    change("README.md", "M", " "),
    change("src/lib/b.ts", "M", " "),
    change("src/c.ts", "M", " "),
  ];
  expect(
    [...byFolder(files)].map(([folder, group]) => [
      folder,
      group.map((c) => c.path),
    ]),
  ).toEqual([
    ["src", ["src/a.ts", "src/c.ts"]],
    ["", ["README.md"]],
    ["src/lib", ["src/lib/b.ts"]],
  ]);
});

it("colours a conflict over its status letter", () => {
  expect(changeKind("?")).toBe("added");
  expect(changeKind("D")).toBe("deleted");
  expect(changeKind("R")).toBe("modified");
  expect(changeKind("A", true)).toBe("conflict");
});

it("follows a selected diff to the list it moved to, and drops it once the file is clean", () => {
  const unstagedSel = { path: "src/b.ts", area: "unstaged" as const };
  expect(settleSelection(unstagedSel, [staged])).toEqual({
    path: "src/b.ts",
    area: "staged",
  });
  const stagedSel = { path: "c.md", area: "staged" as const };
  expect(settleSelection(stagedSel, [untracked])).toEqual({
    path: "c.md",
    area: "unstaged",
  });
  const kept = { path: "src/a.ts", area: "staged" as const };
  expect(settleSelection(kept, [partly])).toBe(kept);
  const inConflict = { path: "src/d.ts", area: "unstaged" as const };
  expect(settleSelection(inConflict, [conflicted])).toBe(inConflict);
  expect(settleSelection(kept, [staged])).toBeNull();
  const env = { path: ".env.local", area: "ignored" as const };
  const touch = {
    path: ".env.local",
    agent: "claude",
    before: "kept",
  } as const;
  expect(settleSelection(env, [], [touch])).toBe(env);
  expect(settleSelection(env, [], [])).toBeNull();
});

it("reveals the working diff first, and knows a partly staged file's other list", () => {
  expect(revealArea(partly)).toBe("unstaged");
  expect(revealArea(staged)).toBe("staged");
  expect(otherArea(partly, "staged")).toBe("unstaged");
  expect(otherArea(partly, "unstaged")).toBe("staged");
  expect(otherArea(untracked, "unstaged")).toBeNull();
  expect(otherArea(staged, "staged")).toBeNull();
  expect(otherArea(conflicted, "staged")).toBe("unstaged");
});

it("reads back only a well-formed saved view", () => {
  expect(parseSavedChanges(undefined)).toEqual({
    selected: null,
    message: "",
    grouped: false,
  });
  expect(
    parseSavedChanges({
      selected: { path: "a.ts", area: "staged" },
      message: "Fix",
      grouped: true,
    }),
  ).toEqual({
    selected: { path: "a.ts", area: "staged" },
    message: "Fix",
    grouped: true,
  });
  expect(
    parseSavedChanges({
      selected: { path: "a.ts", area: "both" },
      message: 3,
      grouped: "yes",
    }),
  ).toEqual({ selected: null, message: "", grouped: false });
});
