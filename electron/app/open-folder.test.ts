import { afterEach, beforeEach, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project } from "../../shared/projects/project";
import {
  launchFolder,
  projectForFolder,
  type FolderProjects,
} from "./open-folder";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "relay-open-folder-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function projects(listed: Project[], repositories: string[] = []) {
  const added: string[] = [];
  const api: FolderProjects = {
    list: async () => listed,
    add: async (folder) => {
      added.push(folder);
      return project(folder);
    },
    repositoryRoot: async (d) =>
      repositories
        .filter((r) => d === r || d.startsWith(r + "/"))
        .sort((a, b) => b.length - a.length)[0] ?? null,
  };
  return { api, added };
}
const project = (path: string): Project => ({
  id: path,
  path,
  name: path.split("/").pop()!,
  repository: null,
  added: 0,
});

it("takes the folder from a launch's arguments, past switches and links", () => {
  mkdirSync(join(dir, "app"));
  expect(
    launchFolder(
      ["--allow-file-access-from-files", "relay-room://join/x", "app"],
      dir,
    ),
  ).toBe(join(dir, "app"));
  expect(launchFolder(["missing", "--flag"], dir)).toBeUndefined();
});

it("opens the innermost project a folder is in, adding nothing", async () => {
  const src = join(dir, "repo", "packages", "web", "src");
  mkdirSync(src, { recursive: true });
  const outer = project(join(dir, "repo"));
  const inner = project(join(dir, "repo", "packages", "web"));
  const { api, added } = projects([outer, inner]);
  expect(await projectForFolder(src, api, dir + "-home")).toEqual({
    project: inner,
  });
  expect(added).toEqual([]);
});

it("adds a folder's repository, not the subfolder it was run in", async () => {
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  const { api, added } = projects([], [repo]);
  await projectForFolder(join(repo, "src"), api, dir + "-home");
  expect(added).toEqual([repo]);
});

it("won't make home or a folder around it a project", async () => {
  const home = join(dir, "me");
  mkdirSync(home);
  const { api, added } = projects([]);
  for (const folder of [home, dir])
    expect(await projectForFolder(folder, api, home)).toHaveProperty("refused");
  expect(added).toEqual([]);
});

it("matches canonical project roots while returning the saved project unchanged", async () => {
  const repo = join(dir, "repo");
  const inner = join(repo, "web");
  mkdirSync(join(inner, "src"), { recursive: true });
  const alias = join(dir, "a-very-long-alias");
  symlinkSync(repo, alias, process.platform === "win32" ? "junction" : "dir");
  const outerProject = project(alias);
  const innerProject = project(inner);
  const { api, added } = projects([outerProject, innerProject]);
  expect(
    await projectForFolder(join(alias, "web", "src"), api, dir + "-home"),
  ).toEqual({ project: innerProject });
  const outer = projects([outerProject]);
  expect(
    await projectForFolder(join(alias, "web"), outer.api, dir + "-home"),
  ).toEqual({ project: outerProject });
  expect([...added, ...outer.added]).toEqual([]);
});
