import type { Ref } from "react";
import { Search } from "lucide-react";
import type { LinkedFolder } from "../../../shared/projects";
import type { ChecksController } from "../checks/useProjectChecks";
import { isWithin } from "./editor-tabs";
import { FileFilterList } from "./FileFilterList";
import { FileTree } from "./FileTree";
import { LinkedFolderTree } from "./LinkedFolderTree";
import { PROJECT_ROOT, useOpenRoots, type useExpanded } from "./useFileTree";

/** Files in the thread's linked folders, which open by their absolute paths. */
export type LinkedFiles = {
  /** The folders linked to the thread with `/add-dir`. */
  links: readonly LinkedFolder[];
  /** The file outside the project in front, by its absolute path. */
  shownPath: string | null;
  onOpenFile: (path: string, preview: boolean) => void;
  onRenamed: (from: string, to: string) => void;
  onTrashed: (path: string) => void;
};

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
  const roots = useOpenRoots(where);
  const hasLinks = linked.links.length > 0;
  const openFile = (path: string, clicks?: number) =>
    onOpenFile(path, clicks === 1);
  const pick = (path: string, kind: "file" | "dir", clicks?: number) =>
    kind === "file" ? openFile(path, clicks) : onPickFolder(path);
  const projectTree = (
    <FileTree
      active={active}
      where={where}
      watched={watched}
      title={title}
      fold={
        hasLinks
          ? {
              open: roots.isOpen(PROJECT_ROOT),
              onToggle: () => roots.toggle(PROJECT_ROOT),
            }
          : undefined
      }
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
  );
  // One scroll for all the trees, each folding under its name.
  const trees = hasLinks ? (
    <div className="file-roots">
      {projectTree}
      {linked.links.map((link) => (
        <LinkedFolderTree
          key={link.path}
          link={link}
          active={active}
          open={roots.isOpen(link.path)}
          onToggle={() => roots.toggle(link.path)}
          shownPath={linked.shownPath}
          onOpenFile={linked.onOpenFile}
          onRenamed={linked.onRenamed}
          onTrashed={linked.onTrashed}
        />
      ))}
    </div>
  ) : (
    projectTree
  );
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
        trees
      )}
    </>
  );
}
