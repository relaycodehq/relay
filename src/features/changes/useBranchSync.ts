import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import type { RebaseConflict } from "./RebaseConflict";
import {
  checkoutChanged,
  type WorkingTree,
} from "../../../shared/working-tree";
import { errorMessage } from "../../../shared/error-message";
import { usePoll } from "../../lib/poll";

// A branch change can touch anything shown, but it just talked to the
// upstream (or didn't need to), so the periodic fetch can wait its turn.
export const everythingButFetch = {
  predicate: (q: { queryKey: readonly unknown[] }) =>
    q.queryKey[0] !== "project-fetch",
};

/**
 * What it takes to bring a workspace's branch level with its upstream: pull,
 * push or rebase, whichever it needs, and a rebase's conflict when it stopped.
 * `where` is the checkout or thread worktree workspace id.
 */
export function useBranchSync(where: string) {
  const poll = usePoll();
  const qc = useQueryClient();
  const treeKey = workingTreeKey(where);
  const tree = useQuery({
    queryKey: treeKey,
    queryFn: () => api.projectWorkingTree(where),
  });
  // Keep "behind" honest: refresh the upstream on focus and every few minutes.
  const remote = useQuery({
    queryKey: ["project-fetch", where],
    queryFn: async () => {
      qc.setQueryData<WorkingTree>(
        treeKey,
        await api.projectGitAction(where, { kind: "fetch" }),
      );
      return Date.now();
    },
    enabled: !!tree.data?.upstream,
    staleTime: 60_000,
    refetchInterval: poll(180_000),
    refetchOnWindowFocus: true,
    retry: false,
  });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const [conflict, setConflict] = useState<RebaseConflict>();
  const [conflictOpen, setConflictOpen] = useState(false);
  const t = tree.data;
  // A branch never pushed has no upstream, but its commits still go somewhere.
  const sync =
    !t?.branch ||
    t.operation ||
    !(t.upstream || t.pushTarget) ||
    (!t.ahead && !t.behind)
      ? null
      : t.ahead && t.behind
        ? "rebase"
        : t.behind
          ? "pull"
          : "push";
  // A conflict stands until either side moves.
  const clash =
    sync === "rebase" &&
    conflict?.tree.head === t?.head &&
    conflict?.tree.behind === t?.behind
      ? conflict
      : undefined;
  async function runSync() {
    if (!t || syncing || !sync || clash) return;
    setSyncing(true);
    setSyncError(undefined);
    const run = async (current: WorkingTree) => {
      if (sync !== "rebase")
        return api.projectGitAction(where, {
          kind: sync,
          revision: current.revision,
        });
      const result = await api.projectRebase(where, current.head);
      if (!result.rebased) {
        setConflict(result);
        setConflictOpen(true);
      }
      return result.tree;
    };
    try {
      let next: WorkingTree;
      try {
        next = await run(t);
      } catch (e) {
        // The view can be a poll behind the checkout. Look again, and go on
        // only if it still calls for the very same pull or push.
        const fresh = (await tree.refetch()).data;
        if (
          !(e instanceof Error && e.message.startsWith(checkoutChanged)) ||
          !fresh ||
          fresh.branch !== t.branch ||
          fresh.ahead !== t.ahead ||
          fresh.behind !== t.behind
        )
          throw e;
        next = await run(fresh);
      }
      qc.setQueryData<WorkingTree>(treeKey, next);
      void qc.invalidateQueries(everythingButFetch);
    } catch (e) {
      setSyncError(errorMessage(e));
      await tree.refetch();
    } finally {
      setSyncing(false);
    }
  }
  return {
    tree,
    t,
    remote,
    sync,
    clash,
    syncing,
    syncError,
    conflictOpen,
    setConflictOpen,
    runSync,
  };
}
export type BranchSync = ReturnType<typeof useBranchSync>;
