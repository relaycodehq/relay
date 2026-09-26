import { expect, it } from "vitest";
import { fileLinkTarget } from "../../mobile/src/remote/links";
import type { TurnFileChange } from "../../shared/projects";

const root = "/Users/test/workspace";
const change = (path: string) =>
  ({ path, additions: 1, deletions: 0 }) as TurnFileChange;
const changes = [
  change("src/guard.ts"),
  change("src/api/cache.ts"),
  change("src/web/cache.ts"),
];

it("opens a file the turn changed on its diff, however the answer names it", () => {
  for (const [value, inline] of [
    ["src/guard.ts:42", false],
    [`${root}/src/guard.ts#L42`, false],
    ["src/guard.ts:42", true],
    ["guard.ts:42", true],
  ] as const)
    expect(fileLinkTarget(value, inline, root, changes)).toEqual({
      kind: "diff",
      change: changes[0],
    });
});

it("opens anything else as it is on disk, and never guesses between changes", () => {
  expect(fileLinkTarget("src/app/main.ts:7", true, root, changes)).toEqual({
    kind: "file",
    path: "src/app/main.ts",
  });
  // Two changed files are called cache.ts; the viewer gets the name as written.
  expect(fileLinkTarget("cache.ts", false, root, changes)).toEqual({
    kind: "file",
    path: "cache.ts",
  });
  expect(fileLinkTarget("src/api/", true, root, changes)).toEqual({
    kind: "folder",
    path: "src/api",
  });
});

it("leaves paths outside the thread's folder, and prose, as text", () => {
  for (const [value, inline] of [
    ["/Users/test/other/guard.ts", false],
    ["~/notes.md", false],
    ["../secret.ts", false],
    ["https://example.com/guard.ts", false],
    ["origin/main", true],
    ["npm test", true],
  ] as const)
    expect(fileLinkTarget(value, inline, root, changes)).toBeNull();
});
