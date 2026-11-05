import { describe, expect, it } from "vitest";
import { groupKey, regroupedFolds } from "./useSidebarFolds";

describe("regroupedFolds", () => {
  const expanded = {
    [groupKey("work")]: true,
    [groupKey("work/old")]: false,
    [groupKey("work/old/deep")]: false,
    [groupKey("work/older")]: false,
    project: false,
  };

  it("keeps a renamed group's groups folded under its new name", () => {
    expect(regroupedFolds(expanded, "work/old", "work/new")).toEqual({
      [groupKey("work")]: true,
      [groupKey("work/old")]: false,
      [groupKey("work/new/deep")]: false,
      [groupKey("work/older")]: false,
      project: false,
    });
  });

  it("keeps them folded in the parent when their group is taken apart", () => {
    // The parent's own fold isn't the removed group's.
    expect(regroupedFolds(expanded, "work/old", "work")).toEqual({
      [groupKey("work")]: true,
      [groupKey("work/old")]: false,
      [groupKey("work/deep")]: false,
      [groupKey("work/older")]: false,
      project: false,
    });
  });
});
