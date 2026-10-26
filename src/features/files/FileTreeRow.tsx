import { useEffect, useRef, useState } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { isEntryName } from "../../../shared/project-files";
import { api } from "../../lib/api";
import type { TreeRow } from "../../lib/file-tree";
import { revealLabel } from "../../lib/mod-key";
import { ContextMenuItem } from "../../ui/ContextMenuItem";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import type { useExpanded } from "./useFileTree";

export function FileTreeRow({
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
  onSelect: (path: string, kind: "file" | "dir", clicks?: number) => void;
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
            className={`file-tree-row tree-row ${selected ? "selected" : ""} ${row.ignored ? "ignored" : ""}`}
            style={{ "--depth": row.depth } as never}
          />
        }
      >
        {dir ? (
          <button
            type="button"
            className="tree-twist"
            tabIndex={-1}
            aria-label={row.open ? "Collapse" : "Expand"}
            disabled={frozen}
            onClick={() => expansion.toggle(row.path)}
          >
            <ChevronRight size={12} className={row.open ? "open" : ""} />
          </button>
        ) : (
          <span className="tree-twist" />
        )}
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
          onClick={(e) => {
            if (!blocked) onSelect(row.path, dir ? "dir" : "file", e.detail);
            if (dir && !frozen) expansion.toggle(row.path);
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

export function NameInput({
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
