import { ContextMenu } from "@base-ui/react/context-menu";
import { Pin, X } from "lucide-react";
import { tabId, type EditorTab } from "./editor-tabs";
import { snapshotOf } from "./snapshots";
import { carriesTab, draggedTab, startDraggingTab } from "./tab-drag";
import { TabMenu, type TabMenuActions } from "./TabMenu";

export const nameOf = (path: string) => path.split(/[/\\]/).pop() ?? path;

type TabItemProps = {
  tab: EditorTab;
  /** Every tab of the split, which the menu's bulk closes pick from. */
  tabs: EditorTab[];
  group: string;
  selected: boolean;
  dirty: (tab: EditorTab) => boolean;
  dragging: boolean;
  folderHint?: string;
  canSplit: boolean;
  menu: TabMenuActions;
  onActivate: (id: string) => void;
  onMove: (from: string, id: string, before: string | null) => void;
  /** The id of the tab being dragged, or none once it's dropped or let go. */
  onDragging: (id: string | undefined) => void;
};

/**
 * One tab: the file's name, a folder hint when another tab has the same name,
 * and × (a pin for a pinned tab, which a middle-click leaves open). Right-click
 * for its menu.
 */
export function TabItem({
  tab,
  tabs,
  group,
  selected,
  dirty,
  dragging,
  folderHint,
  canSplit,
  menu,
  onActivate,
  onMove,
  onDragging,
}: TabItemProps) {
  const id = tabId(tab);
  // A snapshot says which version it is where another tab would say its folder.
  const version = tab.snapshot && snapshotOf(tab.snapshot)?.label;
  const hint = version || folderHint;
  const classes = [
    "editor-tab",
    selected && "active",
    dirty(tab) && "unsaved",
    dragging && "dragging",
  ];
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
          <div
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={version ? `${tab.path} at ${version}` : tab.path}
            className={classes.filter(Boolean).join(" ")}
            draggable
            onDragStart={(e) => {
              startDraggingTab(e, group, id);
              onDragging(id);
            }}
            onDragEnd={() => onDragging(undefined)}
            onDragOver={(e) => {
              if (carriesTab(e) && !dragging) e.preventDefault();
            }}
            onDrop={(e) => {
              const carried = draggedTab(e);
              if (!carried) return;
              e.preventDefault();
              e.stopPropagation();
              if (carried.id !== id || carried.from !== group)
                onMove(carried.from, carried.id, id);
              onDragging(undefined);
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button === 1 && !tab.pinned) menu.onClose(id);
            }}
            onClick={() => onActivate(id)}
          />
        }
      >
        <span className="editor-tab-name">{nameOf(tab.path)}</span>
        {hint && <span className="editor-tab-hint">{hint}</span>}
        <TabButton tab={tab} menu={menu} />
      </ContextMenu.Trigger>
      <TabMenu
        tab={tab}
        tabs={tabs}
        unsaved={dirty}
        canSplit={canSplit}
        actions={menu}
      />
    </ContextMenu.Root>
  );
}

/** × to close the tab, or the pin of a pinned one, which unpins it. */
function TabButton({
  tab,
  menu,
}: {
  tab: EditorTab;
  menu: Pick<TabMenuActions, "onClose" | "onPin">;
}) {
  const id = tabId(tab);
  const name = nameOf(tab.path);
  const pinned = !!tab.pinned;
  return (
    <button
      type="button"
      className={pinned ? "editor-tab-close pinned" : "editor-tab-close"}
      aria-label={`${pinned ? "Unpin" : "Close"} ${name}`}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        if (pinned) menu.onPin(id, false);
        else menu.onClose(id);
      }}
    >
      {pinned ? <Pin size={12} /> : <X size={12} />}
    </button>
  );
}
