import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Pull } from "../../../shared/types";
import type { GitAction, WorkingTree } from "../../../shared/working-tree";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import type { SelectedChange } from "./working-changes";

/**
 * A checkout's working tree, a project's or a PR's linked folder, and the Git
 * actions on it, with what the last one said.
 */
export function useWorkingTree(pull: Pull | undefined, projectId?: string) {
  const qc = useQueryClient(),
    key = projectId
      ? workingTreeKey(projectId)
      : ["working-tree", pull!.owner, pull!.name];
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState("");
  const state = useQuery({
    queryKey: key,
    queryFn: () =>
      projectId ? api.projectWorkingTree(projectId) : api.workingTree(pull!),
    // A project's tree is polled by the shell; a PR checkout polls here.
    refetchInterval: busy || projectId ? false : 3000,
  });
  /** Runs `action`; `done` follows a commit or push once its tree is in. */
  async function act(action: GitAction, done?: () => void) {
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      const next = await (projectId
        ? api.projectGitAction(projectId, action)
        : api.gitAction(pull!, action));
      qc.setQueryData(key, next);
      if (action.kind === "commit") {
        done?.();
        setNotice(
          "Committed locally. Push when you’re ready to share the commit.",
        );
      }
      if (action.kind === "push") {
        done?.();
        setNotice("Pushed successfully.");
      }
    } catch (e) {
      setError(e);
      await state.refetch();
    } finally {
      setBusy(false);
    }
  }
  /** Takes a tree changed elsewhere, such as by splitting into commits. */
  const settle = (next: WorkingTree, said: string) => {
    qc.setQueryData(key, next);
    setError(undefined);
    setNotice(said);
  };
  return {
    key,
    state,
    tree: state.data,
    busy,
    error,
    setError,
    notice,
    act,
    settle,
  };
}

/** The selected file's diff in its list, read again whenever the tree moves. */
export function useWorkingDiff(
  { key, tree }: { key: readonly unknown[]; tree?: WorkingTree },
  pull: Pull | undefined,
  projectId: string | undefined,
  selected: SelectedChange | null,
) {
  return useQuery({
    queryKey: [...key, "diff", selected?.path, selected?.area, tree?.revision],
    queryFn: () =>
      projectId
        ? api.projectWorkingDiff(projectId, selected!.path, selected!.area)
        : api.workingDiff(pull!, selected!.path, selected!.area),
    enabled: !!selected && !!tree,
    gcTime: 0,
  });
}
