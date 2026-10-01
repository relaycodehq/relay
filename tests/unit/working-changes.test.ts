import { expect, it } from "vitest";
import { byFolder, changeKind, otherArea } from "../../src/lib/working-changes";

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

it("knows the other list a partly staged file sits in", () => {
  expect(otherArea(partly, "staged")).toBe("unstaged");
  expect(otherArea(partly, "unstaged")).toBe("staged");
  expect(otherArea(untracked, "unstaged")).toBeNull();
  expect(otherArea(staged, "staged")).toBeNull();
  expect(otherArea(conflicted, "staged")).toBe("unstaged");
});
