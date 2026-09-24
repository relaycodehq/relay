import { describe, expect, it } from "vitest";
import {
  moveGroupInList,
  projectFolderTree,
  projectGroupNameSchema,
  rebaseGroup,
  sortGroupPaths,
} from "../../shared/project-folders";
import type { Project } from "../../shared/projects";

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

describe("projectGroupNameSchema", () => {
  it("rejects slashes and blanks", () => {
    expect(projectGroupNameSchema.safeParse(" Work ").data).toBe("Work");
    expect(projectGroupNameSchema.safeParse("a/b").success).toBe(false);
    expect(projectGroupNameSchema.safeParse("  ").success).toBe(false);
  });
});
