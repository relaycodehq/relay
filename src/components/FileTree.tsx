import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  ChevronRight,
  ChevronsDownUp,
  Copy,
  ExternalLink,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { isEntryName } from "../../shared/project-files";
import { api } from "../lib/api";
import { joinPath, parentOf, treeRows, type TreeRow } from "../lib/file-tree";
import {
  directoryKey,
  useDirectories,
  type useExpanded,
} from "../lib/useFileTree";
import { workingTreeKey } from "../lib/working-tree-key";
import { ContextMenuItem } from "./ContextMenuItem";
import { ErrorBox, FileEntryIcon, IconButton, Modal } from "./ui";
import "./file-browser.css";
import { mac } from "../lib/mod-key";

export const revealLabel = mac
  ? "Show in Finder"
  : navigator.platform.startsWith("Win")
    ? "Show in Explorer"
    : "Show in file manager";

type Editing =
  | { mode: "rename"; path: string }
  | { mode: "create"; dir: string; kind: "file" | "dir" };

export function FileTree({
  where,
  title,
  selected,
  lockedPath,
  expansion,
  onSelect,
  onMoved,
  onTrashed,
  onCreated,
}: {
  where: string;
  title: string;
  selected: string | null;
  /** The file with unsaved edits: it and the folders around it stay as they are. */
  lockedPath: string | null;
  expansion: ReturnType<typeof useExpanded>;
  onSelect: (path: string, kind: "file" | "dir") => void;
  onMoved: (from: string, to: string) => void;
  onTrashed: (path: string) => void;
  onCreated: (path: string, kind: "file" | "dir") => void;
}) {
  const queryClient = useQueryClient();
  const directories = useDirectories(where, expansion.expanded);
  const rows = useMemo(
    () => treeRows(directories.listing, expansion.expanded),
    [directories.listing, expansion.expanded],
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
      className="file-tree-row editing"
      style={{ "--depth": depth } as never}
    >
      <span className="file-tree-twist" />
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
    <div className="file-tree">
      <div className="file-tree-head">
        <strong title={title}>{title}</strong>
        <IconButton
          label="New file"
          onClick={() => startCreate(selectedDir(selected, rows), "file")}
        >
          <FilePlus size={14} />
        </IconButton>
        <IconButton
          label="New folder"
          onClick={() => startCreate(selectedDir(selected, rows), "dir")}
        >
          <FolderPlus size={14} />
        </IconButton>
        <IconButton
          label="Collapse folders"
          disabled={!expansion.expanded.size || !!lockedPath}
          onClick={() => [...expansion.expanded].forEach(expansion.collapse)}
        >
          <ChevronsDownUp size={14} />
        </IconButton>
        <IconButton
          label={revealLabel}
          onClick={() => void run(() => api.revealProjectPath(where, ""))}
        >
          <FolderOpen size={14} />
        </IconButton>
      </div>
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
                className="file-tree-row editing"
                style={{ "--depth": row.depth } as never}
              >
                <span className="file-tree-twist" />
                <FileEntryIcon path={row.path} directory={row.kind === "dir"} />
                <NameInput
                  initial={row.name}
                  onSubmit={submit}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : (
              <Row
                row={row}
                selected={selected === row.path}
                blocked={!!lockedPath && row.path !== lockedPath}
                frozen={locked(row.path)}
                onSelect={onSelect}
                expansion={expansion}
                onCreate={startCreate}
                onRename={() => setEditing({ mode: "rename", path: row.path })}
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
              directories.listing(row.path)?.entries.length === 0 &&
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
        {directories.listing("")?.truncated && (
          <div className="file-tree-hint">Showing the first 5,000 entries.</div>
        )}
      </div>
      {!!error && <ErrorBox error={error} />}
      {trashing && (
        <Modal
          title={`Move “${trashing.name}” to the Trash?`}
          onClose={() => setTrashing(null)}
        >
          <p className="file-tree-confirm">
            The folder and everything in it goes to the Trash, where you can put
            it back.
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
              Move to Trash
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

function Row({
  row,
  selected,
  blocked,
  frozen,
  expansion,
  onSelect,
  onCreate,
  onRename,
  onTrash,
  onReveal,
  onOpenExternal,
}: {
  row: TreeRow;
  selected: boolean;
  blocked: boolean;
  frozen: boolean;
  expansion: ReturnType<typeof useExpanded>;
  onSelect: (path: string, kind: "file" | "dir") => void;
  onCreate: (dir: string, kind: "file" | "dir") => void;
  onRename: () => void;
  onTrash: () => void;
  onReveal: () => void;
  onOpenExternal: () => void;
}) {
  const dir = row.kind === "dir";
  const link = row.kind === "link";
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
          <div
            className={`file-tree-row ${selected ? "selected" : ""} ${row.ignored ? "ignored" : ""}`}
            style={{ "--depth": row.depth } as never}
          />
        }
      >
        <button
          type="button"
          className="file-tree-twist"
          tabIndex={-1}
          aria-label={row.open ? "Collapse" : "Expand"}
          hidden={!dir}
          disabled={frozen}
          onClick={() => expansion.toggle(row.path)}
        >
          <ChevronRight size={12} className={row.open ? "open" : ""} />
        </button>
        <button
          type="button"
          role="treeitem"
          aria-selected={selected}
          aria-expanded={dir ? row.open : undefined}
          data-path={row.path}
          className="file-tree-name-button"
          title={link ? `${row.path} (link)` : row.path}
          // Unsaved edits keep the pane on their file; folders can still open beside it.
          disabled={link || (blocked && !dir)}
          onClick={() => {
            if (!blocked) onSelect(row.path, dir ? "dir" : "file");
            if (dir && !row.open) expansion.expand([row.path]);
          }}
        >
          <FileEntryIcon path={row.path} directory={dir} />
          <span>{row.name}</span>
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="sb-menu-positioner">
          <ContextMenu.Popup className="sb-menu">
            {dir && (
              <>
                <ContextMenuItem
                  icon={<FilePlus size={13} />}
                  onClick={() => onCreate(row.path, "file")}
                >
                  New file
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<FolderPlus size={13} />}
                  onClick={() => onCreate(row.path, "dir")}
                >
                  New folder
                </ContextMenuItem>
                <ContextMenu.Separator className="sb-menu-separator" />
              </>
            )}
            <ContextMenuItem icon={<FolderOpen size={13} />} onClick={onReveal}>
              {revealLabel}
            </ContextMenuItem>
            {!dir && !link && (
              <ContextMenuItem
                icon={<ExternalLink size={13} />}
                onClick={onOpenExternal}
              >
                Open with default app
              </ContextMenuItem>
            )}
            <ContextMenuItem
              icon={<Copy size={13} />}
              onClick={() => void api.writeClipboard(row.path)}
            >
              Copy relative path
            </ContextMenuItem>
            <ContextMenu.Separator className="sb-menu-separator" />
            <ContextMenuItem
              icon={<Pencil size={13} />}
              disabled={frozen}
              hint="F2"
              onClick={onRename}
            >
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              icon={<Trash2 size={13} />}
              disabled={frozen}
              onClick={onTrash}
            >
              Move to Trash
            </ContextMenuItem>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function NameInput({
  initial,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const valid = isEntryName(value.trim());
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    // Renaming replaces the name, not the extension.
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (commit && valid && name !== initial) onSubmit(name);
    else onCancel();
  };
  return (
    <input
      ref={input}
      className="file-tree-name"
      aria-label="Name"
      aria-invalid={!!value.trim() && !valid}
      placeholder={placeholder}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && valid) finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
