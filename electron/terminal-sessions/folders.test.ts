import { expect, it } from "vitest";
import { sessionFolderMatches, sessionFolderQuery } from "./folders";

it("matches Windows folders across namespace, case and separator differences", () => {
  const roots = new Set(["C:\\Work\\project"]);
  for (const path of [
    "\\\\?\\c:\\work\\PROJECT",
    "c:/work/project",
    "C:\\Work\\project\\",
  ])
    expect(sessionFolderMatches(roots, path)).toBe(true);
  for (const path of [
    "C:\\Work\\project-other",
    "C:\\Work\\project\\src",
    "D:\\Work\\project",
  ])
    expect(sessionFolderMatches(roots, path)).toBe(false);
  const query = sessionFolderQuery(roots);
  expect(query.collation).toBe("NOCASE");
  expect(query.paths).toContain("\\\\?\\C:\\Work\\project");
});

it("matches UNC folders without including another server or share", () => {
  const roots = new Set(["\\\\server\\share\\project"]);
  expect(
    sessionFolderMatches(roots, "\\\\?\\UNC\\SERVER\\share\\project"),
  ).toBe(true);
  expect(sessionFolderMatches(roots, "\\\\server\\other\\project")).toBe(false);
  expect(sessionFolderMatches(roots, "\\\\other\\share\\project")).toBe(false);
  expect(sessionFolderQuery(roots).paths).toContain(
    "\\\\?\\UNC\\server\\share\\project",
  );
});

it("preserves case-sensitive POSIX folder matching", () => {
  const roots = new Set(["/work/project"]);
  expect(sessionFolderMatches(roots, "/work/project")).toBe(true);
  expect(sessionFolderMatches(roots, "/Work/project")).toBe(false);
  expect(sessionFolderMatches(roots, "/work/project/src")).toBe(false);
  expect(sessionFolderQuery(roots)).toEqual({
    paths: ["/work/project"],
    collation: "BINARY",
  });
});
