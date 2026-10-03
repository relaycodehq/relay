import { describe, expect, it } from "vitest";
import {
  groupBefore,
  groupPaths,
  moveGroupInList,
  projectPlacement,
  projectFolderTree,
  projectGroupNameSchema,
  rebaseGroup,
  sortGroupPaths,
} from "./project-folders";
import type { Project } from "./projects";

describe("rebaseGroup", () => {
  it("renames a group and everything inside it", () => {
    expect(rebaseGroup("Work", "Work", "Job")).toBe("Job");
    expect(rebaseGroup("Work/Frontend", "Work", "Job")).toBe("Job/Frontend");
    expect(rebaseGroup("Workshop", "Work", "Job")).toBe("Workshop");
  });
  it("ungroups into the parent", () => {
    expect(rebaseGroup("Work", "Work", "")).toBe("");
    expect(rebaseGroup("Work/Frontend", "Work", "")).toBe("Frontend");
    expect(rebaseGroup("Work/Frontend/Web", "Work/Frontend", "Work")).toBe(
      "Work/Web",
    );
  });
});

describe("projectFolderTree", () => {
  it("keeps empty groups", () => {
    const project = { id: "a", name: "a", folder: "Work" } as Project;
    const tree = projectFolderTree([project], ["Home/Side", "Work"]);
    expect(tree.folders.map((f) => f.path)).toEqual(["Home", "Work"]);
    expect(tree.folders[0].folders[0].path).toBe("Home/Side");
    expect(tree.folders[1].projects).toEqual([project]);
  });
});

describe("group order", () => {
  const list = ["Home", "Home/Side", "Work", "Work/Web", "Work/Api", "Zoo"];
  it("moves a group with everything inside it", () => {
    expect(moveGroupInList(list, "Work", "Home")).toEqual([
      "Work",
      "Work/Web",
      "Work/Api",
      "Home",
      "Home/Side",
      "Zoo",
    ]);
    expect(moveGroupInList(list, "Home", null)).toEqual([
      "Work",
      "Work/Web",
      "Work/Api",
      "Zoo",
      "Home",
      "Home/Side",
    ]);
  });
  it("keeps a subgroup last inside its parent without a sibling to precede", () => {
    expect(moveGroupInList(list, "Work/Web", null)).toEqual([
      "Home",
      "Home/Side",
      "Work",
      "Work/Api",
      "Work/Web",
      "Zoo",
    ]);
  });
  it("refuses to move a group out of its parent", () => {
    expect(moveGroupInList(list, "Work/Web", "Home")).toBe(list);
  });
  it("places groups the way the list orders them", () => {
    const tree = projectFolderTree([], ["Zoo", "Work/Web", "Home", "Work/Api"]);
    expect(tree.folders.map((f) => f.path)).toEqual(["Zoo", "Work", "Home"]);
    expect(tree.folders[1].folders.map((f) => f.name)).toEqual(["Web", "Api"]);
  });
  it("sorts never-dragged groups by name at every level", () => {
    const sorted = sortGroupPaths(["Work b", "Work/Web", "Work/Api", "Home"]);
    const tree = projectFolderTree([], sorted);
    expect(tree.folders.map((f) => f.path)).toEqual(["Home", "Work", "Work b"]);
    expect(tree.folders[1].folders.map((f) => f.name)).toEqual(["Api", "Web"]);
  });
});

describe("dropping", () => {
  const projects = [
    { id: "a" },
    { id: "b", folder: "Work" },
    { id: "c" },
    { id: "d", folder: "Work" },
  ];
  it("puts a project dropped after another before that one's next groupmate", () => {
    expect(
      projectPlacement(projects, "c", {
        kind: "project",
        id: "b",
        where: "after",
      }),
    ).toEqual({ folder: "Work", before: "d" });
    expect(
      projectPlacement(projects, "a", {
        kind: "project",
        id: "d",
        where: "after",
      }),
    ).toEqual({ folder: "Work", before: null });
    expect(
      projectPlacement(projects, "a", {
        kind: "project",
        id: "c",
        where: "before",
      }),
    ).toEqual({ folder: "", before: "c" });
  });
  it("skips itself when finding the next groupmate", () => {
    expect(
      projectPlacement(projects, "d", {
        kind: "project",
        id: "b",
        where: "after",
      }),
    ).toEqual({ folder: "Work", before: null });
  });
  it("puts a project dropped on a group last in it, and ignores unlisted neighbours", () => {
    expect(
      projectPlacement(projects, "a", { kind: "folder", path: "Work" }),
    ).toEqual({ folder: "Work", before: null });
    expect(
      projectPlacement(projects, "a", {
        kind: "project",
        id: "x",
        where: "after",
      }),
    ).toBeUndefined();
  });
  it("puts a group dropped after a sibling before the next sibling, past its own subgroups", () => {
    const paths = groupPaths(
      projectFolderTree([], ["Home", "Home/Side", "Work", "Work/Web", "Zoo"]),
    );
    expect(paths).toEqual(["Home", "Home/Side", "Work", "Work/Web", "Zoo"]);
    expect(groupBefore(paths, "Zoo", { path: "Home", where: "after" })).toBe(
      "Work",
    );
    expect(groupBefore(paths, "Home", { path: "Work", where: "after" })).toBe(
      "Zoo",
    );
    expect(groupBefore(paths, "Home", { path: "Zoo", where: "after" })).toBe(
      null,
    );
    expect(groupBefore(paths, "Zoo", { path: "Home", where: "before" })).toBe(
      "Home",
    );
  });
});

describe("projectGroupNameSchema", () => {
  it("rejects slashes and blanks", () => {
    expect(projectGroupNameSchema.safeParse(" Work ").data).toBe("Work");
    expect(projectGroupNameSchema.safeParse("a/b").success).toBe(false);
    expect(projectGroupNameSchema.safeParse("  ").success).toBe(false);
  });
});
