import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChangeArea, WorkingTree } from "../../../shared/working-tree";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import { documents, type DocumentSource } from "../editor/documents";

export type DeletedFiles = ReturnType<typeof useDeletedFiles>;

/**
 * Which of the folder's files are deleted here, so a tab shows the last
 * version instead of failing to read it, and putting one back.
 */
export function useDeletedFiles(
  where: string,
  source: DocumentSource,
  tree: WorkingTree | undefined,
) {
  const qc = useQueryClient();
  const [restoring, setRestoring] = useState<string>();
  const [error, setError] = useState<unknown>();
  /** Deleted in the index too reads the version from HEAD; only on disk, from the index. */
  const deletionArea = (path: string): ChangeArea | undefined => {
    const changes = tree?.changes.filter((c) => c.path === path) ?? [];
    // Taken out of Git alone (git rm --cached), it's still on disk, untracked.
    if (changes.some((c) => c.index === "?")) return undefined;
    const change = changes[0];
    if (change?.index === "D") return "staged";
    if (change?.worktree === "D") return "unstaged";
  };
  /** The area of a deleted file's change, unless an editor holds unsaved text for it: that saves it back instead. */
  const areaOf = (path: string) => {
    const hasUnsavedText = !!documents.find(source, path)?.status.dirty;
    return hasUnsavedText ? undefined : deletionArea(path);
  };
  const restore = async (path: string) => {
    const area = deletionArea(path);
    if (!tree || !area) return;
    setRestoring(path);
    setError(undefined);
    try {
      const next = await api.projectGitAction(where, {
        kind: "discard",
        revision: tree.revision,
        paths: [path],
        area,
      });
      qc.setQueryData(workingTreeKey(where), next);
      await qc.invalidateQueries({
        queryKey: ["project-file-info", where, path],
      });
      void documents.find(source, path)?.load();
    } catch (e) {
      setError(e);
    } finally {
      setRestoring(undefined);
    }
  };
  return { areaOf, restore, restoring, error };
}
