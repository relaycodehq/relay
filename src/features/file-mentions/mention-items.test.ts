import { describe, expect, it } from "vitest";
import {
  fileTree,
  listItems,
  mentionFill,
  mentionTrigger,
} from "./mention-items";
import { foldersOf } from "./file-match";

const files = [
  "README.md",
  "src/app/App.tsx",
  "src/app/titlebar.css",
  "src/features/composer/ProjectComposer.tsx",
  "src/features/composer/composer.css",
];

const changes = new Map([["src/app/App.tsx", "modified" as const]]);
const tree = fileTree(files, new Set(changes.keys()));

describe("mentionTrigger", () => {
  it("opens on @ at a word start, up to the caret", () => {
    expect(mentionTrigger("look at @src/ap")).toEqual({
      query: "src/ap",
      start: 8,
      end: 15,
    });
    expect(mentionTrigger("(@App", 5)?.query).toBe("App");
  });

  it("stays open inside a folder whose name has a space", () => {
    const filled = `see ${mentionFill("Design Assets/")}`;
    expect(mentionTrigger(filled)).toEqual({
      query: "Design Assets/",
      start: 4,
      end: filled.length,
    });
    expect(mentionTrigger(`${filled}log`)?.query).toBe("Design Assets/log");
    expect(mentionFill("src/app/")).toBe("@src/app/");
  });

  it("leaves e-mail addresses and finished mentions alone", () => {
    expect(mentionTrigger("ping me@host")).toBeNull();
    expect(mentionTrigger("@App.tsx and")).toBeNull();
  });
});

describe("listItems", () => {
  it("starts on uncommitted files, then the top folder", () => {
    const items = listItems("", files, foldersOf(files), tree, changes);
    expect(items.map((i) => [i.path, i.section])).toEqual([
      ["src/app/App.tsx", "Uncommitted"],
      ["src/", "Project"],
      ["README.md", undefined],
    ]);
  });

  it("offers folders with what is inside them", () => {
    const item = listItems(
      "composer/",
      files,
      foldersOf(files),
      tree,
      changes,
    ).find((i) => i.dir);
    expect(item).toMatchObject({
      path: "src/features/composer/",
      count: { files: 2, changed: 0 },
    });
  });

  it("lists a typed folder's own entries, folders first", () => {
    const items = listItems("src/", files, foldersOf(files), tree, changes);
    expect(items.map((i) => [i.path, i.count])).toEqual([
      ["src/app/", { files: 2, changed: 1 }],
      ["src/features/", { files: 2, changed: 0 }],
    ]);
  });
});
