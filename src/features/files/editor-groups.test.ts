import { describe, expect, it } from "vitest";
import { tabId } from "./editor-tabs";
import {
  allTabs,
  closeIn,
  dropInGroups,
  focusedGroup,
  MAX_GROUPS,
  moveToGroup,
  openIn,
  parseLayout,
  pinIn,
  recentPaths,
  singleGroup,
  split,
} from "./editor-groups";

const names = (group: { tabs: { path: string }[] }) =>
  group.tabs.map((t) => t.path);

describe("editor splits", () => {
  it("splits right with the file in front showing in both, and opens files in the focused split", () => {
    let layout = openIn(openIn(singleGroup(), { path: "a.ts" }), {
      path: "b.ts",
    });
    const left = layout.focused;
    layout = split(layout, left);
    expect(layout.groups).toHaveLength(2);
    expect(names(focusedGroup(layout))).toEqual(["b.ts"]);
    layout = openIn(layout, { path: "c.ts" });
    expect(names(focusedGroup(layout))).toEqual(["b.ts", "c.ts"]);
    expect(names(layout.groups[0])).toEqual(["a.ts", "b.ts"]);
    expect(allTabs(layout).map(tabId)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("closing a split's last tab closes the split, never the last one", () => {
    const base = openIn(singleGroup(), { path: "a.ts" });
    let layout = split(base, base.focused);
    const right = layout.focused;
    layout = closeIn(layout, right, "a.ts");
    expect(layout.groups).toHaveLength(1);
    expect(layout.focused).toBe(base.focused);
    layout = closeIn(layout, base.focused, "a.ts");
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0].tabs).toHaveLength(0);
  });

  it("moves a tab between splits and caps how many there are", () => {
    const base = openIn(openIn(singleGroup(), { path: "a.ts" }), {
      path: "b.ts",
    });
    let layout = split(base, base.focused);
    layout = moveToGroup(layout, base.focused, "a.ts", layout.focused);
    expect(names(layout.groups[0])).toEqual(["b.ts"]);
    expect(names(layout.groups[1])).toEqual(["b.ts", "a.ts"]);
    for (let i = 0; i < 10; i++) layout = split(layout, layout.focused);
    expect(layout.groups).toHaveLength(MAX_GROUPS);
  });

  it("trashing a folder closes its tabs everywhere and empty splits with them", () => {
    const base = openIn(openIn(singleGroup(), { path: "src/a.ts" }), {
      path: "x.md",
    });
    const layout = split(base, base.focused);
    const one = openIn(layout, { path: "src/b.ts" }, undefined, layout.focused);
    const right = closeIn(one, one.focused, "x.md");
    const dropped = dropInGroups(right, "src");
    expect(dropped.groups).toHaveLength(1);
    expect(names(dropped.groups[0])).toEqual(["x.md"]);
  });

  it("reads tabs saved before splits as one split", () => {
    const old = JSON.stringify({
      tabs: [{ path: "a.ts" }],
      active: "a.ts",
      recent: ["a.ts"],
    });
    const layout = parseLayout(old)!;
    expect(layout.groups).toHaveLength(1);
    expect(names(layout.groups[0])).toEqual(["a.ts"]);
    const saved = parseLayout(JSON.stringify(split(layout, layout.focused)))!;
    expect(saved.groups).toHaveLength(2);
    expect(parseLayout("nope")).toBeUndefined();
  });

  it("lists the focused split's project files by use, leaving out ones outside it", () => {
    let layout = openIn(singleGroup(), { path: "a.ts" });
    layout = openIn(layout, { path: "/tmp/draft.md", outside: true });
    layout = openIn(layout, { path: "b.ts" });
    layout = openIn(layout, { path: "a.ts" });
    expect(recentPaths(layout)).toEqual(["a.ts", "b.ts"]);
  });

  it("splits right with a chosen tab, unpinned, leaving the original pinned", () => {
    let layout = openIn(openIn(singleGroup(), { path: "a.ts" }), {
      path: "b.ts",
    });
    const left = layout.focused;
    layout = pinIn(layout, left, "a.ts", true);
    const right = split(layout, left, "row", "a.ts");
    expect(names(right.groups[1])).toEqual(["a.ts"]);
    expect(right.groups[1].tabs[0].pinned).toBeFalsy();
    expect(right.groups[1].active).toBe("a.ts");
    expect(right.groups[0].tabs[0].pinned).toBe(true);
    expect(right.groups[0].active).toBe("b.ts");
  });

  it("keeps pins through a saved layout", () => {
    let layout = openIn(openIn(singleGroup(), { path: "a.ts" }), {
      path: "b.ts",
    });
    layout = pinIn(layout, layout.focused, "b.ts", true);
    const saved = parseLayout(JSON.stringify(layout))!;
    expect(saved.groups[0].tabs).toEqual([
      { path: "b.ts", pinned: true },
      { path: "a.ts" },
    ]);
  });
});
