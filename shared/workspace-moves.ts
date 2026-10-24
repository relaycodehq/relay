import { agentName } from "./agents";
import type { ChatSummary, ProjectChat, WorkspaceMove } from "./projects";

const KEPT = 20;

/** Notes that `chat` works somewhere else from now on, under its last message so far. */
export function noteWorkspaceMove(
  chat: ProjectChat,
  move: Omit<WorkspaceMove, "at" | "after">,
  at = Date.now(),
) {
  const after = chat.messages.filter((m) => !m.parentId).at(-1)?.id;
  chat.workspaceMoves = [
    ...(chat.workspaceMoves ?? []),
    { at, ...(after ? { after } : {}), ...move },
  ].slice(-KEPT);
}

const folderName = (path: string) => path.split(/[\\/]/).pop() || path;

/** The thread's line where it happened. */
export function workspaceMoveLine(move: WorkspaceMove) {
  const where = move.branch ?? (move.to ? folderName(move.to) : undefined);
  const agent = move.by ? agentName(move.by) : "the agent";
  if (move.how === "project")
    return `${move.by ? agent : "The agent"} moved this thread to ${move.project ?? where ?? "another project"}`;
  if (move.how === "recreated")
    return `${move.fresh ? "New worktree" : "Worktree made again"}${where ? ` on ${where}` : ""}`;
  if (move.how === "moved")
    return `${move.unasked ? `${move.by ? agent : "The agent"} moved` : "Moved"} this thread into its own worktree${where ? ` on ${where}` : ""}`;
  if (!move.to)
    return move.unasked
      ? `Back in the project folder; the worktree ${agent} made is gone`
      : "Switched to the project folder";
  return move.unasked
    ? `Now working in ${where}, a worktree ${agent} made`
    : `Switched to ${where}`;
}

/**
 * One line per spot in the thread: moves under the same message read as
 * where the thread ended up, and none when that's where it already was,
 * like a worktree the agent made and removed for a scratch build.
 */
export function shownWorkspaceMoves(moves: WorkspaceMove[] = []) {
  const shown: WorkspaceMove[] = [];
  let before: string | undefined;
  for (let i = 0; i < moves.length;) {
    let end = i;
    // Bounded: a move with no message before it has `after` undefined, as has the slot past the end.
    while (end + 1 < moves.length && moves[end + 1].after === moves[i].after) end++;
    const group = moves.slice(i, end + 1);
    const last = group[group.length - 1];
    if (last.to !== before || group.some((m) => m.how !== "switched"))
      shown.push(last);
    before = last.to;
    i = end + 1;
  }
  return shown;
}

/** The latest move the user didn't make, if they haven't looked since. */
export function unseenWorkspaceMove(
  chat: Pick<ChatSummary, "workspaceMoves">,
  seenAt: number,
) {
  const last = shownWorkspaceMoves(chat.workspaceMoves).at(-1);
  return last?.unasked && last.at > seenAt ? last : undefined;
}
