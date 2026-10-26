import { useQuery } from "@tanstack/react-query";
import { goneFolder, type Project } from "../../shared/projects";
import { api } from "../lib/api";
import { usePoll } from "../lib/poll";
import { workingTreeKey } from "../lib/working-tree-key";
import { useProjectChecks } from "../features/checks/useProjectChecks";
import { directoryKey } from "../features/files/useFileTree";
import { useTreeWatch } from "./useThreadFolder";

/**
 * What a window showing only a workspace's editor reads of its folder: the
 * working tree (watched, with a slow poll for what a watch misses), checks,
 * and whether the folder is gone. `useThreadFolder` does this for a thread.
 */
export function useEditorFolder(project: Project | undefined, where: string) {
  const poll = usePoll();
  const hasTree = !!project && !project.plain;
  const watched = useTreeWatch(hasTree ? where : null);
  const tree = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
    enabled: hasTree,
    refetchInterval: poll(watched ? 60_000 : 3000),
  });
  // A plain folder has no tree; its root listing notices the folder going.
  const root = useQuery({
    queryKey: directoryKey(where, ""),
    queryFn: () => api.projectDirectory(where, ""),
    enabled: !!project?.plain,
    refetchInterval: poll(5000),
    retry: false,
  });
  const failed = project?.plain ? root : tree;
  const gone = failed.isError ? goneFolder(failed.error) : null;
  const checks = useProjectChecks(
    undefined,
    project && tree.data && !gone
      ? { id: where, head: tree.data.head }
      : undefined,
  );
  return { watched, tree: gone ? undefined : tree.data, gone, checks };
}
