import { expect, it } from "vitest";
import { linksTo, projectFileLink } from "../../src/lib/project-file-links";
const root = "/Users/test/workspace";
it("resolves T3-style markdown and inline file references into the linked project", () => {
  expect(projectFileLink("src/app/main.ts:42", root)).toEqual({
    path: "src/app/main.ts",
    line: 42,
    directory: false,
  });
  expect(
    projectFileLink("file:///Users/test/workspace/src/main.ts#L7", root),
  ).toEqual({ path: "src/main.ts", line: 7, directory: false });
  expect(projectFileLink("src/app/routes/", root, true)).toEqual({
    path: "src/app/routes",
    directory: true,
  });
  expect(projectFileLink("src/app/main.ts:42", root, true)?.line).toBe(42);
});
it("rejects paths outside the clone and ambiguous prose", () => {
  for (const value of [
    "../secret.ts",
    "/Users/test/other/file.ts",
    "https://example.com/file.ts",
    "file:///etc/passwd",
  ])
    expect(projectFileLink(value, root)).toBeNull();
  for (const value of ["node.meta", "origin/main", "example.com/index.html"])
    expect(projectFileLink(value, root, true)).toBeNull();
});
it("matches a changed file to the file or folder a link names", () => {
  const file = { path: "src/app", directory: false };
  expect(linksTo(file, "src/app")).toBe(true);
  expect(linksTo(file, "src/app/main.ts")).toBe(false);
  const folder = { path: "src/app", directory: true };
  expect(linksTo(folder, "src/app/main.ts")).toBe(true);
  expect(linksTo(folder, "src/apps/main.ts")).toBe(false);
  expect(linksTo(folder, "src/app")).toBe(false);
});
