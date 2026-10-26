import { describe, expect, it } from "vitest";
import type { EditorTab } from "./editor-tabs";
import { bulkClose } from "./tab-bulk-close";

const tabs: EditorTab[] = [
  { path: "a", pinned: true },
  { path: "b" },
  { path: "c" },
  { path: "d" },
  { path: "e", pinned: true },
];
const unsavedC = (tab: EditorTab) => tab.path === "c";
const paths = (list: EditorTab[]) => list.map((t) => t.path);

describe("closing several tabs from the menu", () => {
  it("others closes the rest but not pinned or unsaved ones", () => {
    const { closing, unsavedStay } = bulkClose(tabs, "others", "b", unsavedC);
    expect(paths(closing)).toEqual(["d"]);
    expect(paths(unsavedStay)).toEqual(["c"]);
  });

  it("right goes only for tabs after the clicked one", () => {
    expect(paths(bulkClose(tabs, "right", "b", () => false).closing)).toEqual([
      "c",
      "d",
    ]);
    expect(bulkClose(tabs, "right", "d", () => false).closing).toEqual([]);
  });

  it("all includes the clicked tab, and still spares the pinned", () => {
    const { closing, unsavedStay } = bulkClose(tabs, "all", "b", unsavedC);
    expect(paths(closing)).toEqual(["b", "d"]);
    expect(paths(unsavedStay)).toEqual(["c"]);
  });

  it("unmodified leaves unsaved tabs alone without calling them kept", () => {
    const { closing, unsavedStay } = bulkClose(
      tabs,
      "unmodified",
      "b",
      unsavedC,
    );
    expect(paths(closing)).toEqual(["b", "d"]);
    expect(unsavedStay).toEqual([]);
  });
});
