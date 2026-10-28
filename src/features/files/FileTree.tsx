import { Fragment, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import {
  joinPath,
  parentOf,
  treeRows,
  type TreeRow,
} from "../../lib/file-tree";
import { directoryKey, useDirectories, type useExpanded } from "./useFileTree";
import { trashName } from "../../lib/mod-key";
import { workingTreeKey } from "../../lib/working-tree-key";
import { ErrorBox, Modal } from "../../ui/ui";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import { FileTreeHead, type TreeFold } from "./FileTreeHead";
import { FileTreeRow, NameInput } from "./FileTreeRow";
import "../../ui/tree.css";
import "./file-browser.css";

type Editing =
  | { mode: "rename"; path: string }
  | { mode: "create"; dir: string; kind: "file" | "dir" };

export function FileTree({
  active,
  where,
  title,
  selected,
  lockedPath,
  expansion,
  watched,
  fold,
  onSelect,
  onMoved,
  onTrashed,
  onCreated,
}: {
  active: boolean;
  where: string;
  title: string;
  fold?: TreeFold;
  selected: string | null;
  /** The file with unsaved edits: it and the folders around it stay as they are. */
  lockedPath: string | null;
  expansion: ReturnType<typeof useExpanded>;
  /** The shell refreshes open folders when the checkout changes. */
  watched: boolean;
  onSelect: (path: string, kind: "file" | "dir", clicks?: number) => void;
  onMoved: (from: string, to: string) => void;
  onTrashed: (path: string) => void;
  onCreated: (path: string, kind: "file" | "dir") => void;
}) {
  const queryClient = useQueryClient();
  const shown = fold?.open ?? true;
  const directories = useDirectories(
    where,
    expansion.expanded,
    watched,
    active && shown,
  );
  const rows = useMemo(
    () => treeRows(directories.listings, expansion.expanded),
    [directories.listings, expansion.expanded],
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<unknown>();
  const [trashing, setTrashing] = useState<TreeRow | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: directoryKey(where) });
    void queryClient.invalidateQueries({ queryKey: ["project-files", where] });
    void queryClient.invalidateQueries({ queryKey: workingTreeKey(where) });
  };
  const run = async (job: () => Promise<void>) => {
    setError(undefined);
    try {
      await job();
    } catch (e) {
      setError(e);
    } finally {
      refresh();
    }
  };
  const locked = (path: string) =>
    !!lockedPath && (path === lockedPath || lockedPath.startsWith(path + "/"));

  const startCreate = (dir: string, kind: "file" | "dir") => {
    if (dir) expansion.expand([dir]);
    setEditing({ mode: "create", dir, kind });
  };
  const submit = (name: string) => {
    const current = editing;
    setEditing(null);
    if (!current) return;
    if (current.mode === "create") {
      const path = joinPath(current.dir, name);
      void run(async () => {
        await api.createProjectEntry(where, path, current.kind);
        onCreated(path, current.kind);
      });
    } else if (name !== current.path.split("/").pop()) {
      const to = joinPath(parentOf(current.path), name);
      void run(async () => {
        await api.renameProjectEntry(where, current.path, to);
        onMoved(current.path, to);
      });
    }
  };
  const trash = (row: TreeRow) =>
    run(async () => {
      await api.trashProjectEntry(where, row.path);
      onTrashed(row.path);
    });
  const requestTrash = (row: TreeRow) =>
    row.kind === "dir" ? setTrashing(row) : void trash(row);

  const onKeyDown = (event: KeyboardEvent) => {
    if (editing || !(event.target instanceof HTMLElement)) return;
    const el = event.target.closest<HTMLElement>("[data-path]");
    const row = rows.find((r) => r.path === el?.dataset.path);
    if (!el || !row) return;
    const items = [
      ...(body.current?.querySelectorAll<HTMLElement>("[data-path]") ?? []),
    ];
    const focus = (item?: HTMLElement) => {
      if (!item) return;
      event.preventDefault();
      item.focus();
    };
    const at = items.indexOf(el);
    if (event.key === "ArrowDown") focus(items[at + 1]);
    else if (event.key === "ArrowUp") focus(items[at - 1]);
    else if (event.key === "ArrowRight" && row.kind === "dir") {
      event.preventDefault();
      if (row.open) focus(items[at + 1]);
      else expansion.expand([row.path]);
    } else if (event.key === "ArrowLeft") {
      if (row.open && !locked(row.path)) {
        event.preventDefault();
        expansion.collapse(row.path);
      } else
        focus(
          items.find(
            (i) => i.dataset.path === parentOf(row.path) && i.dataset.path,
          ),
        );
    } else if (event.key === "F2" && !locked(row.path)) {
      event.preventDefault();
      setEditing({ mode: "rename", path: row.path });
    } else if (
      (event.key === "Delete" ||
        (event.key === "Backspace" && event.metaKey)) &&
      !locked(row.path)
    ) {
      event.preventDefault();
      requestTrash(row);
    }
  };

  const createRow = (kind: "file" | "dir", depth: number) => (
    <div
      key="create"
      className="file-tree-row tree-row editing"
      style={{ "--depth": depth } as never}
    >
      <span className="tree-twist" />
      <FileEntryIcon
        path={kind === "dir" ? "" : "new"}
        directory={kind === "dir"}
      />
      <NameInput
        initial=""
        placeholder={kind === "dir" ? "Folder name" : "File name"}
        onSubmit={submit}
        onCancel={() => setEditing(null)}
      />
    </div>
  );

  return (
    <div className={`file-tree ${shown ? "" : "folded"}`}>
      <FileTreeHead
        title={title}
        fold={fold}
        canCollapse={!!expansion.expanded.size && !lockedPath}
        onNew={(kind) => startCreate(selectedDir(selected, rows), kind)}
        onCollapseAll={() =>
          [...expansion.expanded].forEach(expansion.collapse)
        }
        onReveal={() => void run(() => api.revealProjectPath(where, ""))}
      />
      {shown && (
        <div
          className="file-tree-body"
          ref={body}
          role="tree"
          onKeyDown={onKeyDown}
        >
          {!!directories.error && <ErrorBox error={directories.error} />}
          {editing?.mode === "create" &&
            editing.dir === "" &&
            createRow(editing.kind, 0)}
          {rows.map((row) => (
            <Fragment key={row.path}>
              {editing?.mode === "rename" && editing.path === row.path ? (
                <div
                  className="file-tree-row tree-row editing"
                  style={{ "--depth": row.depth } as never}
                >
                  <span className="tree-twist" />
                  <FileEntryIcon
                    path={row.path}
                    directory={row.kind === "dir"}
                  />
                  <NameInput
                    initial={row.name}
                    onSubmit={submit}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              ) : (
                <FileTreeRow
                  row={row}
                  selected={selected === row.path}
                  blocked={!!lockedPath && row.path !== lockedPath}
                  frozen={locked(row.path)}
                  onSelect={onSelect}
                  expansion={expansion}
                  onCreate={startCreate}
                  onRename={() =>
                    setEditing({ mode: "rename", path: row.path })
                  }
                  onTrash={() => requestTrash(row)}
                  onReveal={() =>
                    void run(() => api.revealProjectPath(where, row.path))
                  }
                  onOpenExternal={() =>
                    void run(() => api.openProjectPath(where, row.path))
                  }
                />
              )}
              {row.loading && (
                <div
                  className="file-tree-hint"
                  style={{ "--depth": row.depth + 1 } as never}
                >
                  Loading…
                </div>
              )}
              {row.open &&
                !row.loading &&
                directories.listings[row.path]?.entries.length === 0 &&
                !(editing?.mode === "create" && editing.dir === row.path) && (
                  <div
                    className="file-tree-hint"
                    style={{ "--depth": row.depth + 1 } as never}
                  >
                    Empty
                  </div>
                )}
              {editing?.mode === "create" &&
                editing.dir === row.path &&
                createRow(editing.kind, row.depth + 1)}
            </Fragment>
          ))}
          {rows.length === 0 && !directories.error && !editing && (
            <div className="file-tree-hint">This folder is empty.</div>
          )}
          {directories.listings[""]?.truncated && (
            <div className="file-tree-hint">
              Showing the first 5,000 entries.
            </div>
          )}
        </div>
      )}
      {!!error && <ErrorBox error={error} />}
      {trashing && (
        <Modal
          title={`Move “${trashing.name}” to the ${trashName}?`}
          onClose={() => setTrashing(null)}
        >
          <p className="file-tree-confirm">
            The folder and everything in it goes to the {trashName}, where you
            can put it back.
          </p>
          <div className="modal-actions">
            <button onClick={() => setTrashing(null)}>Cancel</button>
            <button
              className="danger"
              autoFocus
              onClick={() => {
                const row = trashing;
                setTrashing(null);
                void trash(row);
              }}
            >
              Move to {trashName}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Where a new file lands: in the selected folder, beside the selected file, else the root. */
function selectedDir(selected: string | null, rows: TreeRow[]) {
  if (!selected) return "";
  return rows.find((r) => r.path === selected)?.kind === "dir"
    ? selected
    : parentOf(selected);
}
