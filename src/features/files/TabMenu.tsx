import { ContextMenu } from "@base-ui/react/context-menu";
import {
  Columns2,
  Copy,
  FolderOpen,
  LocateFixed,
  Pin,
  PinOff,
  X,
} from "lucide-react";
import { revealLabel } from "../../lib/mod-key";
import { ContextMenuItem } from "../../ui/ContextMenuItem";
import { tabId, type EditorTab } from "./editor-tabs";
import { bulkClose, type CloseScope } from "./tab-bulk-close";

/** What the tab menu can do to the tab it was opened on. */
export type TabMenuActions = {
  onClose: (id: string) => void;
  onCloseMany: (scope: CloseScope, from: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  /** A previewed tab stays open when another file is looked at. */
  onKeep: (id: string) => void;
  onCopyPath: (tab: EditorTab) => void;
  onCopyRelativePath: (tab: EditorTab) => void;
  onRevealInList: (tab: EditorTab) => void;
  onShowInFileManager: (tab: EditorTab) => void;
  onSplitRight: (id: string) => void;
};

const closeItems: { scope: CloseScope; label: string }[] = [
  { scope: "others", label: "Close Others" },
  { scope: "all", label: "Close All" },
  { scope: "right", label: "Close Tabs to the Right" },
  { scope: "unmodified", label: "Close Unmodified" },
];

/** The right-click menu of one tab, as an IDE has it. */
export function TabMenu({
  tab,
  tabs,
  unsaved,
  canSplit,
  actions,
}: {
  tab: EditorTab;
  /** Every tab of the split, which the bulk closes pick from. */
  tabs: EditorTab[];
  unsaved: (tab: EditorTab) => boolean;
  canSplit: boolean;
  actions: TabMenuActions;
}) {
  const id = tabId(tab);
  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner className="sb-menu-positioner">
        <ContextMenu.Popup className="sb-menu" aria-label="Tab actions">
          <ContextMenuItem
            icon={<X size={13} />}
            onClick={() => actions.onClose(id)}
          >
            Close
          </ContextMenuItem>
          <CloseItems
            tabs={tabs}
            from={id}
            unsaved={unsaved}
            onCloseMany={actions.onCloseMany}
          />
          <ContextMenu.Separator className="sb-menu-separator" />
          {tab.preview && (
            <ContextMenuItem onClick={() => actions.onKeep(id)}>
              Keep Open
            </ContextMenuItem>
          )}
          <ContextMenuItem
            icon={tab.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            onClick={() => actions.onPin(id, !tab.pinned)}
          >
            {tab.pinned ? "Unpin Tab" : "Pin Tab"}
          </ContextMenuItem>
          <ContextMenu.Separator className="sb-menu-separator" />
          <PathItems tab={tab} actions={actions} />
          <ContextMenu.Separator className="sb-menu-separator" />
          <ContextMenuItem
            icon={<Columns2 size={13} />}
            disabled={!canSplit}
            onClick={() => actions.onSplitRight(id)}
          >
            Split Right
          </ContextMenuItem>
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  );
}

/** How many unsaved tabs a bulk close leaves open; nothing to say when none. */
function unsavedHint(count: number) {
  if (!count) return undefined;
  return `${count} unsaved ${count === 1 ? "stays" : "stay"}`;
}

/** Close Others, All, to the Right and Unmodified, each saying how many unsaved tabs stay. */
function CloseItems({
  tabs,
  from,
  unsaved,
  onCloseMany,
}: {
  tabs: EditorTab[];
  from: string;
  unsaved: (tab: EditorTab) => boolean;
  onCloseMany: TabMenuActions["onCloseMany"];
}) {
  return closeItems.map(({ scope, label }) => {
    const { closing, unsavedStay } = bulkClose(tabs, scope, from, unsaved);
    return (
      <ContextMenuItem
        key={scope}
        disabled={!closing.length}
        hint={unsavedHint(unsavedStay.length)}
        onClick={() => onCloseMany(scope, from)}
      >
        {label}
      </ContextMenuItem>
    );
  });
}

/** Copy the path, show the file in the list or in the file manager. */
function PathItems({
  tab,
  actions,
}: {
  tab: EditorTab;
  actions: TabMenuActions;
}) {
  return (
    <>
      <ContextMenuItem
        icon={<Copy size={13} />}
        onClick={() => actions.onCopyPath(tab)}
      >
        Copy Path
      </ContextMenuItem>
      {!tab.outside && (
        <>
          <ContextMenuItem onClick={() => actions.onCopyRelativePath(tab)}>
            Copy Relative Path
          </ContextMenuItem>
          <ContextMenuItem
            icon={<LocateFixed size={13} />}
            onClick={() => actions.onRevealInList(tab)}
          >
            Reveal in file list
          </ContextMenuItem>
        </>
      )}
      <ContextMenuItem
        icon={<FolderOpen size={13} />}
        onClick={() => actions.onShowInFileManager(tab)}
      >
        {revealLabel}
      </ContextMenuItem>
    </>
  );
}
