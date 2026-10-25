import type { ComponentProps, ReactNode } from "react";
import { Columns2 } from "lucide-react";
import type { ChangeArea, WorkingChange } from "../../../shared/working-tree";
import type { ChecksController } from "../checks/useProjectChecks";
import { IconButton } from "../../ui/ui";
import { DeletedView } from "./DeletedView";
import { MAX_GROUPS, type EditorGroup } from "./editor-groups";
import { tabId, type EditorTab } from "./editor-tabs";
import { EditorTabs } from "./EditorTabs";
import { tabMenuActions } from "./tab-actions";
import { FileViewer } from "./FileViewer";
import { OutsideFile } from "./OutsideFile";
import { SnapshotTab } from "./SnapshotTab";
import type { DeletedFiles } from "./useDeletedFiles";
import type { EditorWorkspace } from "./useEditorWorkspace";

type EditorProps = NonNullable<ComponentProps<typeof FileViewer>["editor"]>;

/** What every split gets from the pane around the editor. */
type PaneProps = {
  where: string;
  /** The pane is in front. */
  active: boolean;
  checks: ChecksController;
  /** What every project file's editor gets; undefined until the folder's HEAD is known. */
  editor: Omit<EditorProps, "reveal" | "closeRequest" | "onClose"> | undefined;
  /** Files deleted here, which show their last version instead. */
  deleted: DeletedFiles;
  /** A file's uncommitted change, if it has one. */
  changeOf: (path: string) => WorkingChange | undefined;
  /** Where no file is open. */
  empty: ReactNode;
  /** Shows a tab's file in the file list, selected. */
  onRevealInList: (group: string, tab: EditorTab) => void;
};

/**
 * The editor's splits side by side, each its own tabs and the file in front
 * of them. Clicking into one makes it where files open; the same file can
 * show in two, kept in step.
 */
export function EditorGroups({
  workspace,
  lead,
  trail,
  ...pane
}: PaneProps & {
  workspace: EditorWorkspace;
  /** Before the first split's tabs, like the file list's toggle. */
  lead?: ReactNode;
  /** After the last split's tabs, like the pop-out button. */
  trail?: ReactNode;
}) {
  const { layout } = workspace;
  const last = layout.groups.length - 1;
  return (
    <div className={`editor-groups ${layout.direction}`}>
      {layout.groups.map((group, index) => (
        <EditorSplit
          key={group.id}
          workspace={workspace}
          group={group}
          position={index}
          lead={index === 0 ? lead : undefined}
          trail={index === last ? trail : undefined}
          {...pane}
        />
      ))}
    </div>
  );
}

/** One split: its tabs, and the file in front of them. */
function EditorSplit({
  workspace: ws,
  group,
  position,
  lead,
  trail,
  ...pane
}: PaneProps & {
  workspace: EditorWorkspace;
  group: EditorGroup;
  position: number;
  lead?: ReactNode;
  trail?: ReactNode;
}) {
  const { layout } = ws;
  const tab = group.tabs.find((t) => tabId(t) === group.active);
  const splitCount = layout.groups.length;
  const focused = group.id === layout.focused && splitCount > 1;
  const canSplit = splitCount < MAX_GROUPS;
  return (
    <section
      className={`editor-group${focused ? " focused" : ""}`}
      aria-label={splitCount > 1 ? `Editor split ${position + 1}` : undefined}
      onFocusCapture={() => ws.focus(group.id)}
      onPointerDownCapture={() => ws.focus(group.id)}
    >
      <EditorTabs
        group={group.id}
        tabs={group.tabs}
        active={group.active}
        dirty={ws.unsaved}
        canSplit={canSplit}
        menu={tabMenuActions(ws, group.id, pane.where, pane.onRevealInList)}
        lead={lead}
        trail={
          <>
            {tab && canSplit && (
              <IconButton
                label="Split right"
                className="editor-split-button"
                onClick={() => ws.split(group.id, "row")}
              >
                <Columns2 size={14} />
              </IconButton>
            )}
            {trail}
          </>
        }
        onActivate={(tabKey) => {
          const picked = group.tabs.find((t) => tabId(t) === tabKey);
          if (picked) ws.activate(group.id, picked);
        }}
        onMove={(from, tabKey, before) =>
          ws.move(from, tabKey, group.id, before)
        }
      />
      <SplitBody workspace={ws} group={group.id} tab={tab} {...pane} />
    </section>
  );
}

type SplitView =
  | { kind: "empty" }
  | { kind: "outside"; tab: EditorTab }
  | { kind: "snapshot"; tab: EditorTab; id: string }
  | { kind: "deleted"; tab: EditorTab; area: ChangeArea }
  | { kind: "file"; tab: EditorTab };

function splitView(
  tab: EditorTab | undefined,
  deleted: DeletedFiles,
): SplitView {
  if (!tab) return { kind: "empty" };
  if (tab.snapshot) return { kind: "snapshot", tab, id: tab.snapshot };
  if (tab.outside) return { kind: "outside", tab };
  const area = deleted.areaOf(tab.path);
  return area ? { kind: "deleted", tab, area } : { kind: "file", tab };
}

/** Narrows a reveal or close request to the split and tab it was made for. */
function forTab<T extends { group: string; id: string }>(
  request: T | undefined,
  group: string,
  id: string,
) {
  return request?.group === group && request.id === id ? request : undefined;
}

/** What shows below a split's tabs for the tab in front. */
function SplitBody({
  workspace: ws,
  group,
  tab,
  where,
  active,
  checks,
  editor,
  deleted,
  changeOf,
  empty,
}: PaneProps & {
  workspace: EditorWorkspace;
  group: string;
  tab: EditorTab | undefined;
}) {
  const view = splitView(tab, deleted);
  switch (view.kind) {
    case "empty":
      return empty;
    case "outside":
      return (
        <OutsideFile
          key={`${group}:${tabId(view.tab)}`}
          active={active}
          path={view.tab.path}
          reveal={forTab(ws.reveal, group, tabId(view.tab))}
          checks={checks}
          onOpen={(path) => ws.open({ path, outside: true })}
          onClose={() => ws.closed(group, tabId(view.tab))}
        />
      );
    case "snapshot":
      return <SnapshotTab key={`${group}:${view.id}`} id={view.id} onAsk={editor?.onAsk} />;
    case "deleted":
      return (
        <DeletedView
          key={`${group}:${tabId(view.tab)}:deleted`}
          where={where}
          path={view.tab.path}
          area={view.area}
          restoring={deleted.restoring === view.tab.path}
          error={deleted.error}
          onRestore={() => void deleted.restore(view.tab.path)}
          onAsk={editor?.onAsk}
        />
      );
    case "file":
      return (
        <FileViewer
          key={`${group}:${tabId(view.tab)}`}
          active={active}
          where={where}
          path={view.tab.path}
          change={changeOf(view.tab.path)}
          editor={
            editor && {
              ...editor,
              reveal: forTab(ws.reveal, group, tabId(view.tab)),
              closeRequest: forTab(ws.closing, group, tabId(view.tab))?.nonce,
              onClose: () => ws.closed(group, tabId(view.tab)),
            }
          }
        />
      );
  }
}
