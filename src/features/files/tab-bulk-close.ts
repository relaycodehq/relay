import { tabId, type EditorTab } from "./editor-tabs";

/** Which of a split's tabs a context-menu close goes for, besides the one clicked. */
export type CloseScope = "others" | "right" | "all" | "unmodified";

/**
 * What closing `scope` does from the tab `from`. Pinned tabs are never
 * touched. Tabs holding unsaved edits are left open (`unsavedStay`) rather
 * than asked about one after another; closing one by itself still asks.
 */
export function bulkClose(
  tabs: EditorTab[],
  scope: CloseScope,
  from: string,
  hasUnsavedEdits: (tab: EditorTab) => boolean,
) {
  const fromAt = tabs.findIndex((t) => tabId(t) === from);
  const inScope = (at: number) => {
    switch (scope) {
      case "others":
        return at !== fromAt;
      case "right":
        return at > fromAt;
      case "all":
      case "unmodified":
        return true;
    }
  };
  const candidates = tabs.filter((t, at) => !t.pinned && inScope(at));
  const closing = candidates.filter((t) => !hasUnsavedEdits(t));
  // "Unmodified" never meant the unsaved ones, so nothing is being kept from it.
  const unsavedStay =
    scope === "unmodified" ? [] : candidates.filter((t) => hasUnsavedEdits(t));
  return { closing, unsavedStay };
}
