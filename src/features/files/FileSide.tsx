import type { Ref } from "react";
import { Search } from "lucide-react";
import type { ChecksController } from "../checks/useProjectChecks";
import { isWithin } from "./editor-tabs";
import { FileFilterList } from "./FileFilterList";
import { FileTree } from "./FileTree";
import type { useExpanded } from "./useFileTree";

type FileSideProps = {
  /** The sidebar is showing and the Files tab is in front. */
  active: boolean;
  where: string;
  watched: boolean;
  title: string;
  filter: string;
  onFilter: (filter: string) => void;
  findInput: Ref<HTMLInputElement>;
  /** The file in front. */
  shownPath: string | null;
  /** The folder picked in the tree. */
  folder: string | null;
  expansion: ReturnType<typeof useExpanded>;
  checks: ChecksController;
  onOpenFile: (path: string) => void;
  onPickFolder: (path: string | null) => void;
  onRenamed: (from: string, to: string) => void;
  onTrashed: (path: string) => void;
};

/** The Files view of the sidebar: a find box over the folder's tree, or the files matching it. */
export function FileSide({
  active,
  where,
  watched,
  title,
  filter,
  onFilter,
  findInput,
  shownPath,
  folder,
  expansion,
  checks,
  onOpenFile,
  onPickFolder,
  onRenamed,
  onTrashed,
}: FileSideProps) {
  const pick = (path: string, kind: "file" | "dir") =>
    kind === "file" ? onOpenFile(path) : onPickFolder(path);
  return (
    <>
      <div className="search-field">
        <Search size={14} />
        <input
          ref={findInput}
          aria-label="Find project file"
          placeholder="Find file…"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
      </div>
      {filter ? (
        <FileFilterList
          where={where}
          enabled={active}
          filter={filter}
          shownPath={shownPath}
          checks={checks}
          onOpen={onOpenFile}
        />
      ) : (
        <FileTree
          active={active}
          where={where}
          watched={watched}
          title={title}
          selected={shownPath ?? folder}
          lockedPath={null}
          expansion={expansion}
          onSelect={pick}
          onCreated={pick}
          onMoved={(from, to) => {
            expansion.remap(from, to);
            onRenamed(from, to);
            if (folder && isWithin(folder, from))
              onPickFolder(to + folder.slice(from.length));
          }}
          onTrashed={(path) => {
            expansion.remap(path, null);
            onTrashed(path);
            if (folder && isWithin(folder, path)) onPickFolder(null);
          }}
        />
      )}
    </>
  );
}
