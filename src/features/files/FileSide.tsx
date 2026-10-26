import type { Ref } from "react";
import { Search } from "lucide-react";
import type { ChecksController } from "../checks/useProjectChecks";
import { FileFilterList } from "./FileFilterList";
import { FileTrees, type LinkedFiles } from "./FileTrees";
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
  /** A file looked at opens as a preview; a double click or a new file keeps it. */
  onOpenFile: (path: string, preview: boolean) => void;
  onPickFolder: (path: string | null) => void;
  onRenamed: (from: string, to: string) => void;
  onTrashed: (path: string) => void;
  linked: LinkedFiles;
};

/**
 * The Files view of the sidebar: a find box over the folder's tree, or the
 * files matching it. With folders linked to the thread, each has a tree under
 * the project's, and every tree folds away under its name.
 */
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
  linked,
}: FileSideProps) {
  const openFile = (path: string, clicks?: number) =>
    onOpenFile(path, clicks === 1);
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
          onOpen={openFile}
        />
      ) : (
        <FileTrees
          active={active}
          where={where}
          watched={watched}
          title={title}
          shownPath={shownPath}
          folder={folder}
          expansion={expansion}
          onOpenFile={onOpenFile}
          onPickFolder={onPickFolder}
          onRenamed={onRenamed}
          onTrashed={onTrashed}
          linked={linked}
        />
      )}
    </>
  );
}
