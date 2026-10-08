import { describe, expect, it } from "vitest";
import { foldersOf, matchPath, rankPaths } from "./file-match";

const files = [
  "packages/compat/index.ts",
  "src/features/composer/ProjectComposer.tsx",
  "src/features/composer/composer.css",
  "src/features/composer/prompt/pills.ts",
  "src/features/projects/ProjectSettings.tsx",
  "src/app/App.tsx",
  "src/app/usePaneOpens.ts",
  "electron/main.ts",
  "README.md",
];
const first = (query: string) => rankPaths(files, query)[0]?.path;

describe("rankPaths", () => {
  it("prefers letters at word starts in the file name", () => {
    expect(first("pcomp")).toBe("src/features/composer/ProjectComposer.tsx");
    expect(first("pset")).toBe("src/features/projects/ProjectSettings.tsx");
  });

  it("puts an exact file name ahead of a folder of the same name", () => {
    expect(first("app")).toBe("src/app/App.tsx");
    expect(first("pills")).toBe("src/features/composer/prompt/pills.ts");
  });

  it("follows a typed folder path", () => {
    expect(first("composer/css")).toBe("src/features/composer/composer.css");
    expect(first("app/pane")).toBe("src/app/usePaneOpens.ts");
  });

  it("drops paths missing a letter, or with the letters out of order", () => {
    expect(rankPaths(files, "zzz")).toEqual([]);
    expect(matchPath("electron/main.ts", "niam")).toBeNull();
  });
});

describe("matchPath", () => {
  it("marks the characters that matched", () => {
    const match = matchPath("src/app/App.tsx", "app")!;
    expect(match.positions).toEqual([8, 9, 10]);
  });

  it("matches across case and ignores spaces in the query", () => {
    expect(matchPath("src/app/App.tsx", "SRC app")).not.toBeNull();
  });
});

describe("foldersOf", () => {
  it("lists every folder once, with its trailing slash", () => {
    expect(foldersOf(["a/b/c.ts", "a/d.ts", "e.ts"]).sort()).toEqual([
      "a/",
      "a/b/",
    ]);
  });
});
