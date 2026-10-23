import { expect, it } from "vitest";
import {
  chatFileLink,
  linksTo,
  matchLink,
  projectFileLink,
  splitOutsidePath,
} from "./project-file-links";
const root = "/Users/test/workspace";
it("resolves markdown links and inline code file references into the linked project", () => {
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
  expect(
    projectFileLink("electron/git/turn-changes.ts:223-226", root, true),
  ).toEqual({
    path: "electron/git/turn-changes.ts",
    line: 223,
    endLine: 226,
    directory: false,
  });
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
it("keeps link and inline positions, folders and the clone boundary apart", () => {
  expect(projectFileLink("src/a.ts#L10C5", root)).toEqual({
    path: "src/a.ts",
    line: 10,
    directory: false,
  });
  expect(projectFileLink("./a.ts?x#y", root)).toEqual({
    path: "a.ts",
    directory: false,
  });
  expect(projectFileLink("file:///Users/test/workspace/../x", root)).toBeNull();
  expect(projectFileLink("src/a.ts#L3", root, true)).toBeNull();
  expect(projectFileLink("src/a.ts#L3", root)?.line).toBe(3);
  expect(projectFileLink("/Users/test/workspace/a.ts#L5", root, true)).toEqual({
    path: "a.ts",
    line: 5,
    directory: false,
  });
  expect(projectFileLink("src/a.ts:0", root, true)).toEqual({
    path: "src/a.ts",
    directory: false,
  });
  expect(projectFileLink("a.com/", root, true)).toEqual({
    path: "a.com",
    directory: true,
  });
  expect(projectFileLink("src/dir/", root)).toBeNull();
  expect(projectFileLink("/Users/test/workspace/src/", root)).toEqual({
    path: "src",
    directory: true,
  });
  expect(projectFileLink("src/a.ts", root + "/")?.path).toBe("src/a.ts");
  expect(projectFileLink("src/a.ts", "")).toBeNull();
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
it("finds the file a bare name or partial path names", () => {
  const paths = [
    "license-report.ts",
    "src/api/license-report.ts",
    "src/shared/license-report.ts",
    "src/app/main.ts",
  ];
  const link = (path: string) => ({ path, directory: false });
  // An exact path wins over files that merely end with it.
  expect(matchLink(link("license-report.ts"), paths)).toEqual([
    "license-report.ts",
  ]);
  expect(matchLink(link("license-report.ts"), paths.slice(1))).toEqual([
    "src/api/license-report.ts",
    "src/shared/license-report.ts",
  ]);
  expect(matchLink(link("app/main.ts"), paths)).toEqual(["src/app/main.ts"]);
  expect(matchLink(link("in.ts"), paths)).toEqual([]);
});
it("links files outside the clone by their absolute path", () => {
  expect(
    chatFileLink("/tmp/wi-stale-operator-account-link.md", root, true),
  ).toEqual({
    path: "/tmp/wi-stale-operator-account-link.md",
    directory: false,
    outside: true,
  });
  expect(chatFileLink("~/notes/plan.md:12", root, true)).toMatchObject({
    path: "~/notes/plan.md",
    line: 12,
    outside: true,
  });
  expect(chatFileLink("file:///etc/hosts.allow", root)?.outside).toBe(true);
  // Inside the clone it stays a project link.
  expect(chatFileLink("/Users/test/workspace/src/a.ts", root)).toEqual({
    path: "src/a.ts",
    directory: false,
  });
});
it("leaves routes, slashless folders and commands outside the clone as text", () => {
  for (const value of [
    "/api/users.json",
    "/api/users/",
    "/tmp/drafts",
    "/usr/local/bin/node",
    "~/",
    "C:\\",
  ])
    expect(chatFileLink(value, root, true)).toBeNull();
});
it("links folders outside the clone written with a trailing slash", () => {
  const folder = (path: string) => ({ path, directory: true, outside: true });
  expect(chatFileLink("/tmp/drafts/", root, true)).toEqual(
    folder("/tmp/drafts"),
  );
  expect(chatFileLink("~/Downloads/invoices/", root, true)).toEqual(
    folder("~/Downloads/invoices"),
  );
  expect(chatFileLink("C:\\Users\\me\\Downloads\\", root, true)).toEqual(
    folder("C:\\Users\\me\\Downloads"),
  );
  expect(chatFileLink("file:///home/me/out/", root)).toEqual(
    folder("/home/me/out"),
  );
});
it("splits an outside path into its folder and name", () => {
  expect(splitOutsidePath("/tmp/a/b.md")).toEqual({
    folder: "/tmp/a",
    name: "b.md",
  });
  expect(splitOutsidePath("/x.md")).toEqual({ folder: "/", name: "x.md" });
  expect(splitOutsidePath("~/x.md")).toEqual({ folder: "~", name: "x.md" });
  expect(splitOutsidePath("C:\\x.md")).toEqual({
    folder: "C:\\",
    name: "x.md",
  });
});
it("takes a Windows path for an absolute one", () => {
  expect(chatFileLink("C:\\Users\\me\\notes.md", root, true)).toEqual({
    path: "C:\\Users\\me\\notes.md",
    directory: false,
    outside: true,
  });
  expect(
    projectFileLink("C:\\work\\app\\src\\a.ts:3", "C:\\work\\app", true),
  ).toEqual({ path: "src/a.ts", line: 3, directory: false });
});
