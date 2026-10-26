import { isWithin } from "./editor-tabs";
import { FileTree } from "./FileTree";
import type { TreeFold } from "./FileTreeHead";
import type { useExpanded } from "./useFileTree";

/**
 * The project's own tree in the Files sidebar. A file picked opens, a folder
 * picked is the one new files land in, and a folder that moves or goes to
 * the Trash takes the pick with it.
 */
export function ProjectFileTree({
  active,
  where,
  watched,
  title,
  fold,
  shownPath,
  folder,
  expansion,
  onOpenFile,
  onPickFolder,
  onRenamed,
  onTrashed,
}: {
  active: boolean;
  where: string;
  watched: boolean;
  title: string;
  fold?: TreeFold;
  /** The file in front. */
  shownPath: string | null;
  /** The folder picked in the tree. */
  folder: string | null;
  expansion: ReturnType<typeof useExpanded>;
  onOpenFile: (path: string, preview: boolean) => void;
  onPickFolder: (path: string | null) => void;
  onRenamed: (from: string, to: string) => void;
  onTrashed: (path: string) => void;
}) {
  const pick = (path: string, kind: "file" | "dir", clicks?: number) =>
    kind === "file" ? onOpenFile(path, clicks === 1) : onPickFolder(path);
  return (
    <FileTree
      active={active}
      where={where}
      watched={watched}
      title={title}
      fold={fold}
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
}
