import {
  ChevronRight,
  ChevronsDownUp,
  FilePlus,
  FolderOpen,
  FolderPlus,
} from "lucide-react";
import { revealLabel } from "../../lib/mod-key";
import { IconButton } from "../../ui/ui";

/** With other folders' trees beside it, a tree folds away under its title; `path` says where it is. */
export type TreeFold = { open: boolean; path?: string; onToggle: () => void };

/** The title of a tree, which folds it when there are others, and the buttons that act on its root. */
export function FileTreeHead({
  title,
  fold,
  canCollapse,
  onNew,
  onCollapseAll,
  onReveal,
}: {
  title: string;
  fold?: TreeFold;
  /** Some folder is open and none is held open by unsaved edits. */
  canCollapse: boolean;
  onNew: (kind: "file" | "dir") => void;
  onCollapseAll: () => void;
  onReveal: () => void;
}) {
  return (
    <div className="file-tree-head">
      {fold ? (
        <button
          type="button"
          className="file-tree-fold"
          aria-expanded={fold.open}
          title={fold.path ?? title}
          onClick={fold.onToggle}
        >
          <ChevronRight size={12} className={fold.open ? "open" : ""} />
          <strong>{title}</strong>
        </button>
      ) : (
        <strong title={title}>{title}</strong>
      )}
      {(fold?.open ?? true) && (
        <>
          <IconButton label="New file" onClick={() => onNew("file")}>
            <FilePlus size={14} />
          </IconButton>
          <IconButton label="New folder" onClick={() => onNew("dir")}>
            <FolderPlus size={14} />
          </IconButton>
          <IconButton
            label="Collapse folders"
            disabled={!canCollapse}
            onClick={onCollapseAll}
          >
            <ChevronsDownUp size={14} />
          </IconButton>
          <IconButton label={revealLabel} onClick={onReveal}>
            <FolderOpen size={14} />
          </IconButton>
        </>
      )}
    </div>
  );
}
