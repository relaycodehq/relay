import { useQuery } from "@tanstack/react-query";
import type { ProjectFileLink } from "../../shared/project-file-links";
import type { CodeReference } from "../../shared/code-references";
import {
  worktreeDiff,
  worktreeQuery,
  type TurnDiffTarget,
} from "../features/changes/turn-diff";
import { WorktreeSwitch } from "../features/changes/WorktreeSwitch";
import { LocalChanges } from "../features/changes/LocalChanges";
import { TurnChanges } from "../features/changes/TurnChanges";
import type { Viewing } from "../features/thread/useThreadView";
import type { RequestChannel } from "../lib/request-channel";
import type { PaneSlots } from "../ui/WorkspacePanes";
import { usePoll } from "../lib/poll";

/**
 * Uncommitted work in the folder the thread works in (the checkout, or its
 * worktree), or what one agent turn changed while a turn is open. A changed
 * file clicked in the chat selects its row here; unchanged ones open in the
 * Files pane.
 */
export function ProjectChanges({
  where,
  slots,
  onViewing,
  onOpenFile,
  onAsk,
  turn,
  onShowTurn,
  onCloseTurn,
  reveals,
  chatId,
  inWorktree,
  onOpenThread,
  onOpenOutside,
  agentRunning,
}: {
  /** Workspace id: the checkout, or the thread's worktree. */
  where: string;
  slots: PaneSlots;
  onViewing: (v: Viewing) => void;
  onOpenFile: (path: string, line?: number) => void;
  onAsk: (ref: CodeReference) => void;
  turn?: (TurnDiffTarget & { request: number }) | null;
  onShowTurn: (target: TurnDiffTarget) => void;
  onCloseTurn: () => void;
  reveals: RequestChannel<ProjectFileLink>;
  /** The thread, whose agents' changes in other repositories list here too. */
  chatId?: string;
  /** The thread works in a worktree Relay made, which can be diffed against its source branch. */
  inWorktree?: boolean;
  onOpenThread?: (chatId: string) => void;
  onOpenOutside?: (path: string) => void;
  agentRunning?: boolean;
}) {
  const poll = usePoll();
  const worktree = useQuery(worktreeQuery(chatId, !!inWorktree, poll)).data;
  const live = worktree?.path && !worktree.removed ? worktree : undefined;
  const toggle = chatId && live && (
    <WorktreeSwitch
      slots={slots}
      status={live}
      where={where}
      showing={!turn ? "uncommitted" : turn.worktree ? "source" : "turn"}
      turnFiles={turn && !turn.worktree ? turn.files.length : undefined}
      onUncommitted={onCloseTurn}
      onAgainstSource={() => {
        if (!turn?.worktree) onShowTurn(worktreeDiff(chatId, live));
      }}
    />
  );
  if (turn)
    return (
      <>
        {toggle}
        <TurnChanges
          key={turn.request}
          // The worktree's files keep changing while it stays open.
          target={turn.worktree && live ? { ...turn, files: live.files } : turn}
          workspace={where}
          slots={slots}
          onClose={toggle ? undefined : onCloseTurn}
          onOpenFile={onOpenFile}
        />
      </>
    );
  return (
    <>
      {toggle}
      <LocalChanges
        projectId={where}
        slots={slots}
        onOpenFile={onOpenFile}
        onAsk={onAsk}
        onSelection={(path) => onViewing({ path, viewed: 0, total: 0 })}
        reveals={reveals}
        chatId={chatId}
        onOpenThread={onOpenThread}
        onOpenOutside={onOpenOutside}
        agentRunning={agentRunning}
      />
    </>
  );
}
