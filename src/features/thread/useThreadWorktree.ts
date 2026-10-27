import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChatSummary,
  ChatWorkspace,
  Project,
  ProjectChat,
  WorktreeStart,
} from "../../../shared/projects";
import {
  agentWorktreeKey,
  agentWorktreeUnavailable,
  reviewFolder,
  reviewFolderLabel,
  threadWorktree,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import {
  loadDraftWorkspace,
  projectWorkspace,
  saveDraftStart,
  saveDraftWorkspace,
  useDraftRecord,
} from "../composer/drafts";
import type { ThreadHandle } from "./useThreadHandle";
import { workingTreeKey } from "../../lib/working-tree-key";
import { threadStorage } from "../../lib/thread-storage";
import { workspaceId } from "../../../shared/workspaces";
import { chatKey } from "../../lib/chat-events";
import { useNavigationLock } from "../../lib/navigation-lock";
import { worktreeQuery } from "../changes/turn-diff";
import { projectChatsQuery } from "../../lib/workspace-queries";
import { usePoll } from "../../lib/poll";

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
  const poll = usePoll();
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
  // A paired computer the new thread starts on instead, in a worktree there.
  const [startOn, setStartOn] = useState<{ id: string; name: string }>();
  // A branch picked to switch the checkout to, which got a worktree instead
  // because the checkout couldn't switch; `reason` says why.
  const [detour, setDetour] = useState<{ branch: string; reason: string }>();
  // The new worktree's branch as typed; empty leaves it to Relay.
  const [newBranch, setNewBranch] = useState(() =>
    chat ? "" : threadStorage(id).branch.load(),
  );
  useEffect(() => {
    if (!chat) threadStorage(id).branch.save(newBranch);
  }, [newBranch, !chat]);
  // Where the new worktree starts; none is off the checkout's commit. Read
  // from the draft, so dropping the scope there drops it here too.
  const saved = useDraftRecord(id, (draft) =>
    draft.start ? JSON.stringify(draft.start) : undefined,
  );
  const start = useMemo(
    () => (saved ? (JSON.parse(saved) as WorktreeStart) : undefined),
    [saved],
  );
  const setStart = (next: WorktreeStart | undefined) => {
    if (!chat) saveDraftStart(id, next);
  };
  // A draft from when threads were joined by thread carries on that one's
  // branch instead, as the picker shows; with the thread gone, it's none.
  const joining =
    !chat && start && "thread" in start ? start.thread : undefined;
  const threads = useQuery({
    ...projectChatsQuery(project.id),
    enabled: !!joining,
  });
  useEffect(() => {
    if (!joining || !threads.data) return;
    const branch = threads.data.find((c) => c.id === joining)?.worktree?.branch;
    setStart(branch ? { on: branch } : undefined);
  }, [joining, threads.data]);
  const query = useQuery(worktreeQuery(chat?.id, !!chat?.worktree, poll));
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
  // Offered only while the deleted worktree's branch is still there to make it from.
  const recreatable = useQuery({
    queryKey: ["agent-worktree-recreatable", chat?.id, chat?.activeAgentWorktree?.path],
    queryFn: () => api.agentWorktreeRecreatable(chat!.id),
    enabled: !!chat && unavailable,
  });
  const removal = useWorktreeRemoval({
    chatId: chat?.id,
    projectId: project.id,
    setError,
    listChanged,
    refetch: () => void query.refetch(),
  });
  useEffect(() => {
    // A finished turn leaves new changes to count.
    if (!running && chat?.worktree) void query.refetch();
  }, [running]);
  async function select(path: string | null) {
    await changeWorkspace(() => api.selectAgentWorktree(chat!.id, path));
  }
  async function recreate() {
    await changeWorkspace(() => api.recreateAgentWorktree(chat!.id));
    // Its answer was about the folder now back; a later deletion asks again.
    qc.removeQueries({ queryKey: ["agent-worktree-recreatable", chat?.id] });
  }
  async function changeWorkspace(change: () => Promise<ChatSummary>) {
    if (!chat || lock.blocked() || running) return;
    await run(async () => {
      const summary = await change();
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
    startOn: chat ? undefined : startOn,
    setStartOn,
    detour: chat ? undefined : detour,
    setDetour,
    newBranch,
    setNewBranch,
    start: chat ? undefined : start,
    setStart,
    status,
    /** The workspace its file calls go to, `@` mentions among them. */
    where,
    // Where this thread's files are: links in its answers resolve against it.
    folder: live?.path ?? agentWorktree?.path ?? project.path,
    branch:
      live?.branch ??
      (agentTree.data
        ? (agentTree.data.branch ?? reviewFolderLabel(reviewFolder(chat)))
        : (agentWorktree?.branch ?? reviewFolderLabel(reviewFolder(chat)))),
    inWorktree: !!live || !!agentWorktree,
    /** Its worktree waits on the thread's title for a name. */
    naming: !!live?.naming,
    unavailable,
    recreatable: !!recreatable.data,
    select,
    recreate,
    selectionDisabled: running || lock.locked,
    ...removal,
  };
}

/** Removing the thread's worktree, from its dialog. */
function useWorktreeRemoval({
  chatId,
  projectId,
  setError,
  listChanged,
  refetch,
}: {
  chatId: string | undefined;
  projectId: string;
  setError: ThreadHandle["setError"];
  listChanged: ThreadHandle["listChanged"];
  refetch: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"remove">();
  async function remove() {
    if (!chatId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.removeProjectWorktree(chatId);
      // What ran in it stopped with it.
      void qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      refetch();
      void qc.invalidateQueries({ queryKey: workingTreeKey() });
      void listChanged();
    }
  }
  return {
    busy,
    /** The Remove dialog, while it is open. */
    dialog,
    setDialog,
    remove,
  };
}
