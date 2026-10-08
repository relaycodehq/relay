import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChatSummary,
  ChatWorkspace,
  Project,
  ProjectChat,
} from "../../../shared/projects";
import {
  agentWorktreeKey,
  agentWorktreeUnavailable,
  threadWorktree,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import {
  loadDraftWorkspace,
  projectWorkspace,
  saveDraftWorkspace,
} from "../composer/drafts";
import type { ThreadHandle } from "./useThreadHandle";
import { workingTreeKey } from "../../lib/working-tree-key";
import { threadStorage } from "../../lib/thread-storage";
import { workspaceId } from "../../../shared/workspaces";
import { chatKey } from "../../lib/chat-events";
import { useNavigationLock } from "../../lib/navigation-lock";

export type ThreadWorktree = ReturnType<typeof useThreadWorktree>;

/** Where a thread works: its managed worktree, or an explicitly selected agent worktree. */
export function useThreadWorktree({
  handle: { chat, id, setError, listChanged, run },
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
  const lock = useNavigationLock();
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
  // The new worktree's branch as typed; empty leaves it to Relay.
  const [newBranch, setNewBranch] = useState(() =>
    chat ? "" : threadStorage(id).branch.load(),
  );
  useEffect(() => {
    if (!chat) threadStorage(id).branch.save(newBranch);
  }, [newBranch, !chat]);
  const query = useQuery({
    queryKey: ["worktree", chat?.id],
    queryFn: () => api.projectWorktree(chat!.id),
    enabled: !!chat?.worktree,
    refetchInterval: 5000,
  });
  const status = query.data;
  const live = status?.path && !status.removed ? status : undefined;
  const agentWorktree = !chat?.worktree ? threadWorktree(chat) : undefined;
  const unavailable = agentWorktreeUnavailable(chat);
  const where = workspaceId(
    project.id,
    chat?.id,
    chat?.activeAgentWorktree
      ? agentWorktreeKey(chat.activeAgentWorktree)
      : undefined,
  );
  // Read the shell's poll so external branch switches and detached HEAD stay honest.
  const agentTree = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
    enabled: !!agentWorktree && !unavailable,
  });
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
  async function select(path: string | null) {
    if (!chat || lock.blocked() || running) return;
    await run(async () => {
      const summary = await api.selectAgentWorktree(chat.id, path);
      qc.setQueriesData<ChatSummary[]>(
        { queryKey: ["project-chats", project.id] },
        (list) => list?.map((c) => (c.id === chat.id ? summary : c)),
      );
      qc.setQueryData<ProjectChat>(
        chatKey(chat.id),
        (previous) =>
          previous && {
            ...previous,
            ...summary,
            activeAgentWorktree: summary.activeAgentWorktree,
            agentWorktrees: summary.agentWorktrees,
          },
      );
      void qc.invalidateQueries({ queryKey: workingTreeKey() });
      void listChanged();
    });
  }
  return {
    workspace,
    setWorkspace,
    newBranch,
    setNewBranch,
    status,
    /** The workspace its file calls go to, `@` mentions among them. */
    where,
    // Where this thread's files are: links in its answers resolve against it.
    folder: live?.path ?? agentWorktree?.path ?? project.path,
    branch:
      live?.branch ??
      (agentTree.data
        ? (agentTree.data.branch ?? undefined)
        : agentWorktree?.branch),
    inWorktree: !!live || !!agentWorktree,
    unavailable,
    select,
    selectionDisabled: running || lock.locked,
    busy,
    /** The Remove or Move dialog, while one is open. */
    dialog,
    setDialog,
    remove,
  };
}
