import { api } from "../lib/api";
import type { CommitVersion } from "../features/changes/CommitChanges";
import type { TurnDiffTarget } from "../features/changes/turn-diff";
import { committedChange, workingChange } from "../features/files/change-opens";
import type { FilesRequest } from "../features/files/file-link-target";

/**
 * Opening one file of a turn's, the worktree's or a commit's changes in the
 * editor once its versions are read. `startRequest` marks the open as the
 * latest and says whether it still is when the answer arrives.
 */
export function changeOpeners({
  where,
  openInEditor,
  startRequest,
  onError,
}: {
  where: string;
  openInEditor: (target: FilesRequest) => boolean;
  startRequest: () => () => boolean;
  onError: (error: unknown) => void;
}) {
  return {
    /**
     * One file of a turn's changes, or of what the worktree has that its
     * branch doesn't, against how it was before; the worktree's list shows
     * in the sidebar.
     */
    async openTurnDiff(target: TurnDiffTarget) {
      if (target.worktree) openInEditor({ view: "branch" });
      const path = target.path ?? target.files[0]?.path;
      if (!path) return;
      const isCurrent = startRequest();
      try {
        const pair = target.worktree
          ? await api.projectWorktreeDiff(target.chatId, path)
          : await api.projectTurnDiff(target.chatId, target.messageId, path);
        if (!isCurrent()) return;
        const before = target.worktree ? (target.from ?? "its branch") : "before turn";
        const id = `turn:${target.chatId}:${target.messageId}:${path}`;
        openInEditor(workingChange(pair, { path }, before, id));
      } catch (e) {
        if (isCurrent()) onError(e);
      }
    },
    /** A file as `commit` left it, read-only, with what the commit changed in place. */
    async openCommitFile(commit: CommitVersion, path: string) {
      const isCurrent = startRequest();
      try {
        const pair = await api.projectCommitDiff(where, commit.sha, path);
        if (isCurrent()) openInEditor(committedChange(pair, path, commit, `commit:${commit.sha}:${path}`));
      } catch (e) {
        if (isCurrent()) onError(e);
      }
    },
  };
}
