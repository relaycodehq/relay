import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { workspaceId } from "../../shared/workspaces";
import { liveAway } from "../../shared/handoff";
import {
  agentWorktreeKey,
  agentWorktreeUnavailable,
  goneFolder,
  threadWorktree,
} from "../../shared/projects";
import { api } from "../lib/api";
import { agentWorkingIn, worktreeThread } from "./thread-folder";
import { useProjectChecks } from "../features/checks/useProjectChecks";
import { directoryKey } from "../features/files/useFileTree";
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
  const worktree = threadWorktree(inWorktree);
  // Its agent worktree was deleted: Git there only fails until the composer's row picks where it goes on.
  const deleted = agentWorktreeUnavailable(chat);
  // Live on another computer, the panes show its worktree there.
  const away =
    chat?.sentTo?.folder && liveAway(chat) ? chat.sentTo.computer : undefined;
  const where = project
    ? workspaceId(
        project.id,
        inWorktree?.id,
        chat?.activeAgentWorktree && !chat.worktree
          ? agentWorktreeKey(chat.activeAgentWorktree)
          : undefined,
      )
    : "";
  const hasTree = !!project && !inbox && !project.plain && !deleted;
  // Away, its folder is on that computer; a watch here would see the copy left behind.
  const watched = useTreeWatch(hasTree && !away ? where : null);
  // The one reader of the working tree: panes, pickers and the chat read this
  // cache. Every polling observer would run its own round of Git commands.
  // Watched, it refreshes when the folder changes; the slow poll catches what
  // a watch misses, as a change on another volume or one made while it started.
  const tree = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
    enabled: hasTree,
    refetchInterval: watched ? 60_000 : 3000,
  });
  // A plain folder has no tree to poll; its root listing, shared with the
  // Files tree, notices the folder going instead.
  const root = useQuery({
    queryKey: directoryKey(where, ""),
    queryFn: () => api.projectDirectory(where, ""),
    enabled: !!project && !inbox && !!project.plain,
    refetchInterval: 5000,
    retry: false,
  });
  /** The project folder's path once it was moved or deleted, so panes stand aside. */
  const gone = project?.plain
    ? root.isError
      ? goneFolder(root.error)
      : null
    : tree.isError
      ? goneFolder(tree.error)
      : null;
  // Live checks for the working tree. A PR thread's review runs its own checks
  // (one session at a time), so the working-tree checks stand aside there.
  const checks = useProjectChecks(
    undefined,
    // Away, there's nothing here to check: its files are on that computer.
    project && tree.data && !gone && !deleted && !inbox && !pull && !away
      ? { id: where, head: tree.data.head }
      : undefined,
    // An agent rewriting files would trigger a recheck on every save.
    agentWorkingIn(chats.data, inWorktree),
  );
  return {
    /** Workspace id: the checkout, or the thread's worktree. */
    where,
    /** For pane headers: which worktree they show. */
    detail: away
      ? {
          text: `on ${away}`,
          title: `${worktree?.branch ?? "Detached HEAD"} · in its worktree on ${away}`,
        }
      : worktree && !deleted
        ? {
            text: "worktree",
            title: `${worktree.branch ?? "Detached HEAD"} · ${worktree.path}`,
          }
        : undefined,
    tree: gone || deleted ? undefined : tree.data,
    gone,
    /** The thread's worktree was deleted; panes stand aside until it moves. */
    deleted,
    checks,
  };
}

/**
 * Asks Relay to say when `where`'s working tree may have changed, and
 * refreshes it then; true while Relay watches it. One per window: Relay
 * watches the one place each window last asked for. A hidden window refreshes
 * once it shows again, as the poll it replaces waited.
 */
function useTreeWatch(where: string | null) {
  const qc = useQueryClient();
  const [watched, setWatched] = useState<string | null>(null);
  useEffect(() => {
    if (where === null) return;
    let missed = false,
      live = true;
    const refresh = (cancelRefetch = true) => {
      missed = false;
      void qc.invalidateQueries(
        { queryKey: workingTreeKey(where), exact: true },
        { cancelRefetch },
      );
    };
    const ask = (first: boolean) =>
      api.watchWorkingTree(where).then(
        (ok) => {
          if (!live) return;
          setWatched(ok ? where : null);
          // Nothing watched it while another place showed, and its cached
          // tree is fresh enough that the slow poll would wait up to a minute.
          // A fetch already under way for it is left to finish.
          if (ok && first) refresh(false);
        },
        () => live && setWatched(null),
      );
    const off = api.onWorkingTree((changed) => {
      if (changed !== where) return;
      // A watch that broke says so with a change, and again once it's back.
      void ask(false);
      if (document.hidden) missed = true;
      else refresh();
    });
    const shown = () => {
      if (missed && !document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", shown);
    void ask(true);
    return () => {
      live = false;
      off();
      document.removeEventListener("visibilitychange", shown);
      void api.watchWorkingTree(null).catch(() => {});
    };
  }, [where, qc]);
  return where !== null && watched === where;
}
