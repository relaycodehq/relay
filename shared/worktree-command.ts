import type { ChatMessage, WorktreeCommandRun } from "./projects";

/** "Setting up the worktree…", "Worktree setup failed (exit 1)" and the like. */
export function worktreeCommandNote(
  run: WorktreeCommandRun,
  status: ChatMessage["status"],
) {
  const setup = run.kind === "setup";
  if (status === "streaming")
    return setup ? "Setting up the worktree…" : "Tearing down the worktree…";
  if (status === "complete")
    return setup ? "Worktree set up" : "Worktree torn down";
  const what = setup ? "Worktree setup" : "Worktree teardown";
  if (run.stopped === "timeout") return `${what} timed out`;
  if (status === "cancelled" || run.stopped === "cancelled")
    return `${what} stopped`;
  return run.exitCode !== undefined && run.exitCode > 0
    ? `${what} failed (exit ${run.exitCode})`
    : `${what} failed`;
}

/** The ignored files `.worktreeinclude` brought along, for the top of the output. */
export const copiedNote = (copied: string[]) =>
  `Copied from the project folder: ${copied.join(", ")}`;

/** A setup run that didn't get through, which its row offers to run again. */
export const setupCanRerun = (m: ChatMessage) =>
  m.worktreeCommand?.kind === "setup" &&
  (m.status === "failed" || m.status === "cancelled");

/** The thread's latest setup run: the only one that can run again. */
export const latestSetup = (messages: ChatMessage[]) =>
  [...messages].reverse().find((m) => m.worktreeCommand?.kind === "setup");
