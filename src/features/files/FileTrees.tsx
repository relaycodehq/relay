import type { LinkedFolder } from "../../../shared/projects";
import { LinkedFolderTree } from "./LinkedFolderTree";
import { ProjectFileTree } from "./ProjectFileTree";
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

/**
 * The project's tree, and with folders linked to the thread, each linked
 * folder's under it. They share one scroll and each folds under its name.
 */
export function FileTrees({
  active,
  where,
  watched,
  title,
  shownPath,
  folder,
  expansion,
  onOpenFile,
  onPickFolder,
  onRenamed,
  onTrashed,
  linked,
}: {
  active: boolean;
  where: string;
  watched: boolean;
  title: string;
  /** The file in front. */
  shownPath: string | null;
  /** The folder picked in the tree. */
  folder: string | null;
  expansion: ReturnType<typeof useExpanded>;
  onOpenFile: (path: string, preview: boolean) => void;
  onPickFolder: (path: string | null) => void;
  onRenamed: (from: string, to: string) => void;
  onTrashed: (path: string) => void;
  linked: LinkedFiles;
}) {
  const roots = useOpenRoots(where);
  const hasLinks = linked.links.length > 0;
  const projectTree = (
    <ProjectFileTree
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
      shownPath={shownPath}
      folder={folder}
      expansion={expansion}
      onOpenFile={onOpenFile}
      onPickFolder={onPickFolder}
      onRenamed={onRenamed}
      onTrashed={onTrashed}
    />
  );
  if (!hasLinks) return projectTree;
  return (
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
  );
}
