import { useState, type RefObject } from "react";
import { ancestors } from "../../lib/file-tree";
import type { Reveal } from "../editor/TextFile";
import { tabsGone } from "./closed-tabs";
import { openIn, type EditorLayout } from "./editor-groups";
import { tabId, type EditorTab } from "./editor-tabs";
import {
  leave,
  stepBack,
  stepForward,
  type History,
} from "./navigation-history";
import { caretPlace, hasUnsavedEdits, type TabHome } from "./tab-documents";
import type { ClosedTabs } from "./useClosedTabs";

/** Where to put the caret in a file being opened, and whether to show its changes inline, against what. */
export type OpenAt = Omit<Reveal, "nonce">;

/**
 * Opening a file in a split, and Back and Forward through the places jumps
 * left from. `history` is owned by the caller, whose closing tabs forget it.
 * A tab closed to make room goes on `closedTabs`, like one closed by hand.
 */
export function useTabOpening({
  layout,
  setLayout,
  home,
  frontTab,
  history,
  closedTabs,
  expand,
}: {
  layout: EditorLayout;
  setLayout: (change: (layout: EditorLayout) => EditorLayout) => void;
  home: TabHome;
  /** The tab in front of the focused split. */
  frontTab: EditorTab | null;
  history: RefObject<History>;
  closedTabs: ClosedTabs;
  /** Opens the tree down to a file. */
  expand: (paths: string[]) => void;
}) {
  const [reveal, setReveal] = useState<
    Reveal & { group: string; id: string }
  >();
  const caretNow = () => (frontTab ? caretPlace(frontTab, home) : undefined);

  const show = (tab: EditorTab, at?: OpenAt, group = layout.focused) => {
    if (!tab.outside) expand(ancestors(tab.path));
    const keep = (t: EditorTab) => hasUnsavedEdits(t, home);
    const splitTabs = (l: EditorLayout) =>
      l.groups.find((g) => g.id === group)?.tabs ?? [];
    const madeRoom = tabsGone(
      splitTabs(layout),
      splitTabs(openIn(layout, tab, keep, group)),
    );
    closedTabs.remember(madeRoom.map((gone) => ({ tab: gone, group })));
    setLayout((l) => openIn(l, tab, keep, group));
    const wantsReveal = !!(at?.line || at?.changes || at?.baseline);
    if (wantsReveal)
      setReveal({ group, id: tabId(tab), ...at, nonce: Date.now() });
  };
  const stepThrough = (move: typeof stepBack) => {
    const next = move(history.current, caretNow());
    if (!next) return false;
    history.current = next.history;
    show(next.to.tab, next.to);
    return true;
  };

  const activate = (group: string, tab: EditorTab) => {
    history.current = leave(history.current, caretNow());
    show(tab, undefined, group);
  };

  return {
    reveal,
    /** Somewhere else in the focused split, which Back can return from. */
    open: (tab: EditorTab, at?: OpenAt) => {
      history.current = leave(history.current, caretNow());
      show(tab, at);
    },
    activate,
    /** Brings back the tab closed last, in its split or the focused one. */
    reopenClosed: () => {
      const next = closedTabs.takeNext(layout);
      if (next) activate(next.group, next.tab);
    },
    back: () => stepThrough(stepBack),
    forward: () => stepThrough(stepForward),
  };
}
