import { useEffect, useRef, useState, type ReactNode } from "react";
import { tabId, type EditorTab } from "./editor-tabs";
import { carriesTab, draggedTab } from "./tab-drag";
import { nameOf, TabItem } from "./TabItem";
import type { TabMenuActions } from "./TabMenu";

/** For tabs that share a file name, the folder that tells them apart. */
function folderHints(tabs: EditorTab[]) {
  const counts = new Map<string, number>();
  for (const tab of tabs)
    counts.set(nameOf(tab.path), (counts.get(nameOf(tab.path)) ?? 0) + 1);
  return (tab: EditorTab) => {
    if ((counts.get(nameOf(tab.path)) ?? 0) < 2) return undefined;
    const parts = tab.path.split(/[/\\]/);
    return parts.length > 1 ? parts[parts.length - 2] : undefined;
  };
}

/**
 * The open files across the top of the editor, as an IDE has them: the one
 * in front marked, a dot on unsaved ones, middle-click or × to close, drag to
 * reorder, right-click for a menu. Scrolls sideways when they don't fit,
 * keeping the front one in view.
 */
export function EditorTabs({
  group,
  tabs,
  active,
  dirty,
  canSplit,
  menu,
  lead,
  trail,
  onActivate,
  onMove,
}: {
  /** Which split these are, so a tab can be dragged into another. */
  group: string;
  tabs: EditorTab[];
  active: string | null;
  dirty: (tab: EditorTab) => boolean;
  /** Another split fits beside these. */
  canSplit: boolean;
  menu: TabMenuActions;
  /** Before the tabs, like the file list's toggle. */
  lead?: ReactNode;
  /** After the tabs, like the pop-out button. */
  trail?: ReactNode;
  onActivate: (id: string) => void;
  /** A tab dropped here from this split or another, before `before` or at the end. */
  onMove: (from: string, id: string, before: string | null) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string>();
  const folderHint = folderHints(tabs);
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>("[aria-selected=true]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <div className="editor-tabs">
      {lead}
      <div
        className="editor-tabs-strip"
        role="tablist"
        aria-label="Open files"
        ref={strip}
        onDragOver={(e) => {
          if (carriesTab(e)) e.preventDefault();
        }}
        onDrop={(e) => {
          const carried = draggedTab(e);
          if (!carried) return;
          e.preventDefault();
          onMove(carried.from, carried.id, null);
          setDragging(undefined);
        }}
      >
        {tabs.map((tab) => (
          <TabItem
            key={tabId(tab)}
            tab={tab}
            tabs={tabs}
            group={group}
            selected={tabId(tab) === active}
            dirty={dirty}
            canSplit={canSplit}
            menu={menu}
            dragging={dragging === tabId(tab)}
            folderHint={folderHint(tab)}
            onActivate={onActivate}
            onMove={onMove}
            onDragging={setDragging}
          />
        ))}
      </div>
      {trail}
    </div>
  );
}
