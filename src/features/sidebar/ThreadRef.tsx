import {
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
} from "lucide-react";
import { threadWorktree, type ChatSummary } from "../../../shared/projects";
import { MiddleTruncate } from "../../ui/MiddleTruncate";

/** The thread's branch or detached commit, with only confirmed merges marked. */
export function ThreadRef({
  chat,
  branchIcon = false,
}: {
  chat: ChatSummary;
  /** Projects' branch lines have an icon even in the project checkout. */
  branchIcon?: boolean;
}) {
  if (!chat.branch)
    return (
      <span
        className="sb-thread-ref"
        title={chat.commit ? `Detached at ${chat.commit}` : undefined}
      >
        {chat.commit && (
          <>
            <GitCommitHorizontal size={11} aria-hidden />
            <span className="sb-ref-commit">{chat.commit}</span>
          </>
        )}
      </span>
    );

  const worktree = !!chat.worktree || !!threadWorktree(chat);
  const by = chat.worktree?.landed?.by;
  const merged =
    chat.worktree?.branch === chat.branch && (by === "pr" || by === "merge");
  const title = merged
    ? `${chat.branch} — ${by === "pr" ? "Merged via pull request" : "Merged in Relay"}`
    : worktree
      ? `Worktree on ${chat.branch}`
      : chat.branch;
  return (
    <span className="sb-thread-ref" title={title}>
      {merged ? (
        <>
          <GitMerge className="sb-ref-merged" size={11} aria-hidden />
          <span className="sb-ref-merged">Merged</span>
          <span className="sb-ref-separator" aria-hidden>
            ·
          </span>
        </>
      ) : worktree ? (
        <FolderGit2 size={11} aria-hidden />
      ) : branchIcon ? (
        <GitBranch size={11} aria-hidden />
      ) : null}
      <MiddleTruncate
        className="sb-ref-branch"
        text={chat.branch}
        kind="branch"
        title={null}
      />
    </span>
  );
}
