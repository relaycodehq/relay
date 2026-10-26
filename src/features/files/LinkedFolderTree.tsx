import { useState } from "react";
import { linkName, type LinkedFolder } from "../../../shared/projects";
import { isWithin } from "./editor-tabs";
import { FileTree } from "./FileTree";
import { useExpanded } from "./useFileTree";

/**
 * A folder linked to the thread with `/add-dir`, as a tree of its own under
 * the project's. Its files open by their absolute paths, as files outside
 * the project do.
 */
export function LinkedFolderTree({
  link,
  active,
  open,
  onToggle,
  shownPath,
  onOpenFile,
  onRenamed,
  onTrashed,
}: {
  link: LinkedFolder;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  /** The file outside the project in front, by its absolute path. */
  shownPath: string | null;
  onOpenFile: (path: string, preview: boolean) => void;
  onRenamed: (from: string, to: string) => void;
  onTrashed: (path: string) => void;
}) {
  const expansion = useExpanded(link.path);
  const [pickedFolder, setPickedFolder] = useState<string | null>(null);
  const absolute = (path: string) => `${link.path}/${path}`;
  const shownHere =
    shownPath && shownPath !== link.path && isWithin(shownPath, link.path)
      ? shownPath.slice(link.path.length + 1)
      : null;
  const pick = (path: string, kind: "file" | "dir", clicks?: number) =>
    kind === "file"
      ? onOpenFile(absolute(path), clicks === 1)
      : setPickedFolder(path);
  return (
    <FileTree
      active={active}
      where={link.path}
      watched={false}
      title={linkName(link.path)}
      fold={{ open, path: link.path, onToggle }}
      selected={shownHere ?? pickedFolder}
      lockedPath={null}
      expansion={expansion}
      onSelect={pick}
      onCreated={pick}
      onMoved={(from, to) => {
        expansion.remap(from, to);
        onRenamed(absolute(from), absolute(to));
      }}
      onTrashed={(path) => {
        expansion.remap(path, null);
        onTrashed(absolute(path));
      }}
    />
  );
}
