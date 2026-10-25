import { useState, type RefObject } from "react";
import { documents } from "../editor/documents";
import {
  allTabs,
  closeIn,
  dropInGroups,
  openIn,
  type EditorLayout,
} from "./editor-groups";
import { bulkClose, type CloseScope } from "./tab-bulk-close";
import { tabId, tabIsWithin, type EditorTab } from "./editor-tabs";
import { forget, type History } from "./navigation-history";
import { hasUnsavedEdits, tabDocument, type TabHome } from "./tab-documents";
import type { ClosedTabs } from "./useClosedTabs";

/** The tab being closed that holds unsaved edits; its editor asks what to do. */
export type ClosingTab = { group: string; id: string; nonce: number };

/**
 * Ways a tab goes away: closed by hand (asking first over unsaved edits),
 * closed in bulk from its menu (leaving unsaved ones), or its file sent to
 * the Trash. Tabs closed by hand go on `closedTabs`; trashed ones don't, as
 * their file is gone.
 */
export function useTabClosing({
  layout,
  setLayout,
  home,
  history,
  closedTabs,
}: {
  layout: EditorLayout;
  setLayout: (change: (layout: EditorLayout) => EditorLayout) => void;
  home: TabHome;
  history: RefObject<History>;
  closedTabs: ClosedTabs;
}) {
  const [closing, setClosing] = useState<ClosingTab>();

  const closeDocument = (tab: EditorTab) => {
    // A snapshot's file may be open in another tab; its document isn't this tab's.
    if (tab.snapshot) return;
    const { source, path } = tabDocument(tab, home);
    documents.close(source, path, true);
  };

  /** The tab's edits are saved or let go: it closes, and its document once no split shows it. */
  const closed = (group: string, id: string) => {
    const inSplit = layout.groups
      .find((g) => g.id === group)
      ?.tabs.find((t) => tabId(t) === id);
    if (inSplit) closedTabs.remember([{ tab: inSplit, group }]);
    const tab = allTabs(layout).find((t) => tabId(t) === id);
    const shownAfter = allTabs(closeIn(layout, group, id)).some(
      (t) => tabId(t) === id,
    );
    if (tab && !shownAfter) {
      closeDocument(tab);
      history.current = forget(history.current, (t) => tabId(t) === id);
    }
    setLayout((l) => closeIn(l, group, id));
  };

  /** Closes a tab, asking first when it holds unsaved edits no other split shows. */
  const requestClose = (group: string, id: string) => {
    const tab = layout.groups
      .find((g) => g.id === group)
      ?.tabs.find((t) => tabId(t) === id);
    if (!tab) return;
    const shownInOtherSplit = layout.groups.some(
      (g) => g.id !== group && g.tabs.some((t) => tabId(t) === id),
    );
    if (!hasUnsavedEdits(tab, home) || shownInOtherSplit)
      return closed(group, id);
    setLayout((l) => openIn(l, tab, undefined, group));
    setClosing({ group, id, nonce: Date.now() });
  };

  /**
   * Closes the tabs of a split that `scope` goes for, from the tab `from`.
   * Pinned tabs and ones with unsaved edits stay open.
   */
  const closeMany = (group: string, scope: CloseScope, from: string) => {
    const tabs = layout.groups.find((g) => g.id === group)?.tabs ?? [];
    const { closing } = bulkClose(tabs, scope, from, (t) =>
      hasUnsavedEdits(t, home),
    );
    const clicked = tabs.find((t) => tabId(t) === from);
    if (scope === "others" && clicked)
      setLayout((l) => openIn(l, clicked, undefined, group));
    for (const tab of closing) closed(group, tabId(tab));
  };

  /** A file or folder went to the Trash: its tabs close, edits and all. */
  const trashed = (path: string) => {
    for (const tab of allTabs(layout))
      if (tabIsWithin(tab, path)) closeDocument(tab);
    setLayout((l) => dropInGroups(l, path));
  };

  return { closing, closed, requestClose, closeMany, trashed };
}
