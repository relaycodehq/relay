import { describe, expect, it } from "vitest";
import {
  projectFolderTree,
  projectGroupNameSchema,
  rebaseGroup,
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

describe("projectGroupNameSchema", () => {
  it("rejects slashes and blanks", () => {
    expect(projectGroupNameSchema.safeParse(" Work ").data).toBe("Work");
    expect(projectGroupNameSchema.safeParse("a/b").success).toBe(false);
    expect(projectGroupNameSchema.safeParse("  ").success).toBe(false);
  });
});
