import { useQuery } from "@tanstack/react-query";
import { workspaceId } from "../../shared/workspaces";
import { api } from "../lib/api";
import { agentWorkingIn, worktreeThread } from "./thread-folder";
import { useProjectChecks } from "../features/checks/useProjectChecks";
import type { ShellNavigation } from "./useShellNavigation";
import { workingTreeKey } from "../lib/working-tree-key";

export type ThreadFolder = ReturnType<typeof useThreadFolder>;

/**
 * The folder the thread's Git and file panes work in: its worktree once it
 * has one, else the project's checkout. Its working tree and checks too.
 */
export function useThreadFolder({
  project,
  chat,
  chats,
  inbox,
  pull,
}: Pick<ShellNavigation, "project" | "chat" | "chats" | "inbox" | "pull">) {
  const inWorktree = worktreeThread(chat);
  const where = project ? workspaceId(project.id, inWorktree?.id) : "";
  // The one poller for the working tree: panes, pickers and the chat read this
  // cache. Every polling observer would run its own round of Git commands.
  const tree = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
    enabled: !!project && !inbox && !project.plain,
    refetchInterval: 3000,
  });
  // Live checks for the working tree. A PR thread's review runs its own checks
  // (one session at a time), so the working-tree checks stand aside there.
  const checks = useProjectChecks(
    undefined,
    project && tree.data && !inbox && !pull
      ? { id: where, head: tree.data.head }
      : undefined,
    // An agent rewriting files would trigger a recheck on every save.
    agentWorkingIn(chats.data, inWorktree),
  );
  return {
    /** Workspace id: the checkout, or the thread's worktree. */
    where,
    /** For pane headers: which worktree they show. */
    detail: inWorktree && {
      text: "worktree",
      title: `${inWorktree.worktree!.branch} · ${inWorktree.worktree!.path}`,
    },
    tree: tree.data,
    checks,
  };
}
