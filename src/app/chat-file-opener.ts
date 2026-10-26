import type { QueryClient } from "@tanstack/react-query";
import {
  matchLink,
  splitOutsidePath,
  type ProjectFileLink,
} from "../../shared/project-file-links";
import type { Project } from "../../shared/projects";
import type { WorkingTree } from "../../shared/working-tree";
import { api } from "../lib/api";
import {
  changedTarget,
  fileTarget,
  type FilesRequest,
} from "../features/files/file-link-target";

/**
 * A file clicked in the chat opens in Files, with its changes in place
 * when it has some (in its Review in a PR thread). A name that fits several
 * files lists them in Files. A file outside the project opens in Files too,
 * a folder outside it in the system's file manager. `startRequest` marks the
 * click as the latest and says whether it still is when an answer arrives.
 */
export function chatFileOpener({
  project,
  where,
  tree,
  inReview,
  qc,
  openInEditor,
  revealInReview,
  startRequest,
  onError,
}: {
  project?: Project;
  where: string;
  tree?: WorkingTree;
  /** The thread is a PR's, whose changes are its Review. */
  inReview: boolean;
  qc: QueryClient;
  openInEditor: (target: FilesRequest) => boolean;
  revealInReview: (target: ProjectFileLink) => void;
  startRequest: () => () => boolean;
  onError: (error: unknown) => void;
}) {
  return async function openChatFile(target: ProjectFileLink) {
    const isCurrent = startRequest();
    if (target.outside && target.directory) {
      const { folder, name } = splitOutsidePath(target.path);
      return void api.revealProjectPath(folder, name).catch(onError);
    }
    if (target.outside) return void openInEditor(target);
    if (inReview) return revealInReview(target);
    const id = where;
    try {
      const changes = project!.plain
        ? []
        : (tree ?? (await api.projectWorkingTree(id))).changes.map(
            (c) => c.path,
          );
      if (!isCurrent()) return;
      const changed = changedTarget(target, changes);
      if (changed)
        return void openInEditor({ ...changed, changes: !changed.directory });
      if (target.directory) {
        // An agent naming a folder elsewhere by its bare name gets a link here.
        const exists = await api.projectDirectory(id, target.path).then(
          () => true,
          () => false,
        );
        if (!isCurrent()) return;
        if (!exists)
          return onError(
            new Error(`There's no ${target.path}/ in this project.`),
          );
        return void openInEditor(target);
      }
      const found = matchLink(
        target,
        await qc.query({
          queryKey: ["project-files", id],
          queryFn: () => api.projectFiles(id),
          staleTime: 5000,
        }),
      );
      if (!isCurrent()) return;
      // Ignored files (an agent's output folder) aren't in Git's list but are on disk.
      const onDisk =
        !found.length &&
        (await api.projectFileInfo(id, target.path).then(
          () => true,
          () => false,
        ));
      if (isCurrent()) openInEditor(fileTarget(target, found, onDisk));
    } catch (e) {
      if (isCurrent()) onError(e);
    }
  };
}
