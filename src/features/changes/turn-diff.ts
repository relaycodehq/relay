import { queryOptions } from "@tanstack/react-query";
import type { TurnFileChange, WorktreeStatus } from "../../../shared/projects";
import { api } from "../../lib/api";
import type { usePoll } from "../../lib/poll";

export type TurnDiffTarget = {
  chatId: string;
  messageId: string;
  files: TurnFileChange[];
  path?: string;
  /** Who answered and when, e.g. "Claude · 12:04". */
  label: string;
  /** Everything the thread's worktree has that the branch it came from doesn't yet. */
  worktree?: boolean;
  /** The branch the worktree came from. */
  from?: string;
};

/** Everything the worktree has that the branch it came from doesn't, opened at `path`. */
export function worktreeDiff(
  chatId: string,
  status: WorktreeStatus,
  path?: string,
): TurnDiffTarget {
  return {
    chatId,
    messageId: "worktree",
    files: status.files,
    path,
    label: status.branch ?? "Worktree",
    worktree: true,
    from: status.from,
  };
}

/**
 * A managed worktree's branch, path and what it has that its source branch
 * doesn't, polled as `poll` paces it (see lib/poll).
 */
export const worktreeQuery = (
  chatId: string | undefined,
  enabled: boolean,
  poll: ReturnType<typeof usePoll>,
) =>
  queryOptions({
    queryKey: ["worktree", chatId],
    queryFn: () => api.projectWorktree(chatId!),
    enabled: !!chatId && enabled,
    // Naming takes a second or two, and the agent starts right after.
    refetchInterval: (q) => poll(q.state.data?.naming ? 400 : 5000),
  });
