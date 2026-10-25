import { expect, it } from "vitest";
import { editorJump, searchJump } from "./open-targets";

it("keeps an editor jump's columns and marks files outside the folder", () => {
  expect(editorJump({ path: "a.ts", line: 3, column: 5 })).toEqual([
    { path: "a.ts" },
    { line: 3, column: 5 },
  ]);
  expect(editorJump({ path: "/tmp/x.md", outside: true })[0]).toEqual({
    path: "/tmp/x.md",
    outside: true,
  });
});

it("moves a search result's 0-based column to the editor's 1-based one", () => {
  expect(searchJump({ path: "a.ts", line: 3, column: 0 })[1]).toEqual({
    line: 3,
    column: 1,
  });
  expect(searchJump({ path: "a.ts", line: 3 })[1].column).toBeUndefined();
});
