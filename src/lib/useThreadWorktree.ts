import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatWorkspace, Project } from "../../shared/projects";
import { api } from "./api";
import {
  loadDraftWorkspace,
  projectWorkspace,
  saveDraftWorkspace,
} from "./drafts";
import type { ThreadHandle } from "./useThreadHandle";
import { workingTreeKey } from "./working-tree-key";

export type ThreadWorktree = ReturnType<typeof useThreadWorktree>;

/** Where a thread works: picked before its first message, then the worktree it made, if any. */
export function useThreadWorktree({
  handle: { chat, id, setError, listChanged },
  project,
  running,
  onDraftWorkspace,
}: {
  handle: ThreadHandle;
  project: Project;
  running: boolean;
  onDraftWorkspace?: (workspace: ChatWorkspace) => void;
}) {
  const qc = useQueryClient();
  // Where a new thread will work; a started one keeps its own.
  const [workspace, setWorkspace] = useState<ChatWorkspace>(() =>
    chat ? "checkout" : loadDraftWorkspace(id, project),
  );
  // Until one is picked here, it follows the project's setting as that changes.
  const projectDefault = projectWorkspace(project);
  useEffect(() => {
    if (!chat) setWorkspace(loadDraftWorkspace(id, project));
  }, [projectDefault]);
  useEffect(() => {
    if (chat) return;
    saveDraftWorkspace(id, workspace, project);
    onDraftWorkspace?.(workspace);
  }, [workspace, !chat]);
  const query = useQuery({
    queryKey: ["worktree", chat?.id],
    queryFn: () => api.projectWorktree(chat!.id),
    enabled: !!chat?.worktree,
    refetchInterval: 5000,
  });
  const status = query.data;
  const live = status?.path && !status.removed ? status : undefined;
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"remove" | "move">();
  useEffect(() => {
    // A finished turn leaves new changes to count.
    if (!running && chat?.worktree) void query.refetch();
  }, [running]);
  async function remove() {
    if (!chat || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.removeProjectWorktree(chat.id);
      // What ran in it stopped with it.
      void qc.invalidateQueries({ queryKey: ["project-tasks", project.id] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      void query.refetch();
      void qc.invalidateQueries({ queryKey: workingTreeKey() });
      void listChanged();
    }
  }
  return {
    workspace,
    setWorkspace,
    status,
    // Where this thread's files are: links in its answers resolve against it.
    folder: live?.path ?? project.path,
    branch: live?.branch,
    busy,
    /** The Remove or Move dialog, while one is open. */
    dialog,
    setDialog,
    remove,
  };
}
