import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { agentName } from "../../../shared/agents";
import {
  matchLink,
  type ProjectFileLink,
} from "../../../shared/project-file-links";
import {
  rootOf,
  type ChatMessage,
  type ChatSummary,
  type WorktreeStatus,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import { forkThreadSettings } from "../agents/composer-settings";
import { prefillClaudeSignIn } from "../terminal/thread-terminals";
import { worktreeDiff, type TurnDiffTarget } from "../changes/turn-diff";
import { useStableCallback } from "../../lib/useStableCallback";
import type { ThreadHandle } from "./useThreadHandle";
import { workingTreeKey } from "../../lib/working-tree-key";

export type ThreadMessageActions = ReturnType<typeof useMessageActions>;

/**
 * What a thread's messages can do. Stable handlers let memoized messages skip
 * re-rendering while typing; each still sees this render's thread.
 */
export function useMessageActions({
  handle: { chat, projectId, setError },
  messages,
  worktree,
  onOpenReply,
  onCreated,
  onOpenCode,
  onOpenFile,
  onOpenTurnDiff,
}: {
  handle: ThreadHandle;
  messages: ChatMessage[];
  worktree?: WorktreeStatus;
  /** Opens the side conversation that starts at `rootId`. */
  onOpenReply: (rootId: string) => void;
  onCreated: (c: ChatSummary) => Promise<void>;
  onOpenCode: (mode: "changes" | "files") => void;
  onOpenFile: (target: ProjectFileLink) => void;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
}) {
  const qc = useQueryClient();
  const chatId = chat?.id;
  const signInToClaude = useCallback(
    () =>
      chatId ? prefillClaudeSignIn(projectId, chatId) : Promise.resolve(false),
    [projectId, chatId],
  );
  const openReply = useStableCallback((m: ChatMessage) =>
    onOpenReply(rootOf(messages, m).id),
  );
  const forkThread = useStableCallback(async (m: ChatMessage) => {
    if (!chatId) return;
    setError(undefined);
    try {
      const forked = await api.forkProjectChat(chatId, m.id);
      forkThreadSettings(chatId, forked.id, m.provider);
      await onCreated(forked);
    } catch (e) {
      setError(e);
    }
  });
  const openChanges = useStableCallback(() => onOpenCode("changes"));
  const openFile = useStableCallback((target: ProjectFileLink) => {
    // A file the worktree changed opens on its worktree diff; the checkout has the old one.
    const matches = worktree
      ? matchLink(
          target,
          worktree.files.map((f) => f.path),
        )
      : [];
    const changed =
      target.directory || matches.length === 1 ? matches[0] : undefined;
    if (chatId && worktree && changed)
      onOpenTurnDiff(worktreeDiff(chatId, worktree, changed));
    else onOpenFile(target);
  });
  const openTurnDiff = useStableCallback((m: ChatMessage, path?: string) => {
    if (!chatId || !m.changes?.length) return;
    onOpenTurnDiff({
      chatId,
      messageId: m.id,
      files: m.changes,
      path,
      label: `${agentName(m.provider)} · ${new Date(
        m.created,
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    });
  });
  const rewindTurn = useStableCallback(
    (
      m: ChatMessage,
      paths: string[] | null,
      mode: "revert" | "redo",
      force: boolean,
    ) => {
      if (!chatId) return Promise.resolve({ conflicts: [] });
      return api
        .rewindProjectTurn(chatId, m.id, paths, mode, force)
        .finally(
          () => void qc.invalidateQueries({ queryKey: workingTreeKey() }),
        );
    },
  );
  return {
    signInToClaude,
    openReply,
    forkThread,
    openChanges,
    openFile,
    openTurnDiff,
    rewindTurn,
  };
}
