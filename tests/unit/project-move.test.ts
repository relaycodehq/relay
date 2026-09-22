import { describe, expect, it } from "vitest";
import { moveProjectInList } from "../../shared/project-folders";

const list = [
  { id: "a", folder: "Work" },
  { id: "b", folder: "Work" },
  { id: "c" },
  { id: "d", folder: "Home" },
];
const order = (l: { id: string; folder?: string }[]) =>
  l.map((p) => `${p.id}:${p.folder ?? ""}`).join(" ");

describe("moveProjectInList", () => {
  it("reorders within a folder", () => {
    expect(order(moveProjectInList(list, "b", "Work", "a"))).toBe(
      "b:Work a:Work c: d:Home",
    );
  });

  it("moves into another folder before a project", () => {
    expect(order(moveProjectInList(list, "c", "Work", "b"))).toBe(
      "a:Work c:Work b:Work d:Home",
    );
  });

  it("appends after the folder's last project without a target", () => {
    expect(order(moveProjectInList(list, "d", "Work", null))).toBe(
      "a:Work b:Work d:Work c:",
    );
  });

  it("moves out of folders and into new ones", () => {
    expect(order(moveProjectInList(list, "a", "", null))).toBe(
      "b:Work c: a: d:Home",
    );
    expect(order(moveProjectInList(list, "c", "New", null))).toBe(
      "a:Work b:Work d:Home c:New",
    );
  });

  it("leaves the list unchanged for a self-drop or unknown id", () => {
    expect(moveProjectInList(list, "a", "Work", "a")).toBe(list);
    expect(moveProjectInList(list, "zz", "", null)).toBe(list);
  });
});
