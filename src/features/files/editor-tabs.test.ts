import { describe, expect, it } from "vitest";
import {
  closeTab,
  dropTabs,
  emptyTabs,
  keepTab,
  MAX_TABS,
  moveTab,
  openTab,
  parseTabs,
  renameTabs,
  setPinned,
  tabId,
  type EditorTab,
} from "./editor-tabs";

const open = (...paths: string[]) =>
  paths.reduce((state, path) => openTab(state, { path }), emptyTabs);
const names = (state: ReturnType<typeof open>) => state.tabs.map(tabId);

describe("editor tabs", () => {
  it("opens beside the tab in front and brings an open one forward", () => {
    let state = open("a", "b", "c");
    state = openTab(state, { path: "a" });
    expect(names(state)).toEqual(["a", "b", "c"]);
    state = openTab(state, { path: "d" });
    expect(names(state)).toEqual(["a", "d", "b", "c"]);
    expect(state.active).toBe("d");
  });

  it("lets the next file looked at take a preview's place, until it's kept", () => {
    const look = (state: ReturnType<typeof open>, path: string) =>
      openTab(state, { path, preview: true });
    let state = look(look(open("a"), "b"), "c");
    expect(names(state)).toEqual(["a", "c"]);
    expect(state.recent).toEqual(["c", "a"]);
    // Opened for keeps, or kept from its tab, a preview stays.
    state = look(openTab(state, { path: "c" }), "d");
    expect(names(state)).toEqual(["a", "c", "d"]);
    state = look(keepTab(state, "d"), "e");
    expect(names(state)).toEqual(["a", "c", "d", "e"]);
    // An unsaved preview isn't replaced either.
    const unsaved = (tab: EditorTab) => tab.path === "e";
    state = openTab(state, { path: "f", preview: true }, unsaved);
    expect(names(state)).toEqual(["a", "c", "d", "e", "f"]);
    // Looking at a file already kept open doesn't make it a preview.
    expect(look(state, "a").tabs[0].preview).toBeUndefined();
  });

  it("closing the tab in front goes back to the one before it", () => {
    let state = open("a", "b", "c");
    state = openTab(state, { path: "a" });
    state = openTab(state, { path: "c" });
    expect(closeTab(state, "c").active).toBe("a");
    expect(closeTab(closeTab(state, "c"), "a").active).toBe("b");
    expect(closeTab(open("a"), "a").active).toBeNull();
  });

  it("makes room by closing the tab longest out of sight, never a kept one", () => {
    let state = open(...Array.from({ length: MAX_TABS }, (_, i) => `f${i}`));
    state = openTab(state, { path: "new" }, (tab) => tab.path === "f0");
    expect(state.tabs).toHaveLength(MAX_TABS);
    expect(names(state)).toContain("f0");
    expect(names(state)).not.toContain("f1");
  });

  it("follows renames and closes trashed folders' tabs", () => {
    let state = open("src/a.ts", "src/b.ts", "readme.md");
    state = renameTabs(state, "src", "lib");
    expect(names(state)).toEqual(["lib/a.ts", "lib/b.ts", "readme.md"]);
    expect(state.recent[0]).toBe("readme.md");
    expect(names(dropTabs(state, "lib"))).toEqual(["readme.md"]);
  });

  it("moves a linked folder's tabs apart from the project's", () => {
    const linked = { path: "/work/api/a.ts", outside: true };
    let state = openTab(open("api/a.ts"), linked);
    state = renameTabs(state, "/work/api", "/work/server", true);
    expect(names(state)).toEqual(["api/a.ts", "outside:/work/server/a.ts"]);
    expect(state.active).toBe("outside:/work/server/a.ts");
    expect(names(dropTabs(state, "/work/server", true))).toEqual(["api/a.ts"]);
    expect(names(dropTabs(state, "api"))).toEqual([
      "outside:/work/server/a.ts",
    ]);
  });

  it("reorders and survives a bad save", () => {
    const state = moveTab(open("a", "b", "c"), "c", "a");
    expect(names(state)).toEqual(["c", "a", "b"]);
    expect(parseTabs("{oops")).toBeUndefined();
    expect(
      parseTabs(
        JSON.stringify({ tabs: [{ path: "x" }, { nope: 1 }], active: "gone" }),
      ),
    ).toEqual({ tabs: [{ path: "x" }], active: null, recent: [] });
  });

  it("pins a tab to the end of the pinned ones, and unpinning drops it below them", () => {
    let state = open("a", "b", "c", "d");
    state = setPinned(state, "c", true);
    state = setPinned(state, "b", true);
    expect(names(state)).toEqual(["c", "b", "a", "d"]);
    state = setPinned(state, "c", false);
    expect(names(state)).toEqual(["b", "c", "a", "d"]);
    expect(state.tabs[1].pinned).toBeUndefined();
  });

  it("keeps new and dragged tabs out of the pinned ones", () => {
    let state = setPinned(open("a", "b", "c"), "a", true);
    state = openTab(state, { path: "p", pinned: true });
    expect(names(state)).toEqual(["a", "p", "b", "c"]);
    expect(names(moveTab(state, "c", "a"))).toEqual(["a", "p", "c", "b"]);
    expect(names(moveTab(state, "a", null))).toEqual(["p", "a", "b", "c"]);
  });

  it("never makes room by closing a pinned tab, however long out of sight", () => {
    let state = open(...Array.from({ length: MAX_TABS }, (_, i) => `f${i}`));
    state = setPinned(state, "f0", true);
    state = setPinned(state, "f1", true);
    state = openTab(state, { path: "new" });
    expect(state.tabs).toHaveLength(MAX_TABS);
    expect(names(state)).toContain("f0");
    expect(names(state)).toContain("f1");
    expect(names(state)).not.toContain("f2");
  });

  it("grows past the limit rather than close pinned or unsaved tabs", () => {
    let state = open(...Array.from({ length: MAX_TABS }, (_, i) => `f${i}`));
    for (const tab of state.tabs) state = setPinned(state, tabId(tab), true);
    state = openTab(state, { path: "new" });
    expect(state.tabs).toHaveLength(MAX_TABS + 1);
    expect(state.active).toBe("new");
  });

  it("saves pins, and reads tabs saved without them", () => {
    const pinned = setPinned(open("a", "b", "c"), "c", true);
    const saved = parseTabs(JSON.stringify(pinned))!;
    expect(names(saved)).toEqual(["c", "a", "b"]);
    expect(saved.tabs[0]).toEqual({ path: "c", pinned: true });
    const old = parseTabs(
      JSON.stringify({ tabs: [{ path: "a" }, { path: "/x", outside: true }] }),
    )!;
    expect(old.tabs).toEqual([{ path: "a" }, { path: "/x", outside: true }]);
  });

  it("restores every pinned tab even when the saved tabs pass the limit", () => {
    const tabs = Array.from({ length: MAX_TABS + 5 }, (_, i) => ({
      path: `f${i}`,
      pinned: i >= MAX_TABS - 1 ? true : undefined,
    }));
    const saved = parseTabs(JSON.stringify({ tabs }))!;
    expect(saved.tabs).toHaveLength(MAX_TABS);
    expect(saved.tabs.filter((t) => t.pinned)).toHaveLength(6);
  });
});
