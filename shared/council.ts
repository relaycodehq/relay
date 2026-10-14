import type { ChatMessage } from "./projects";

/** A council member is finished only when it supplied a written report. */
export function hasCouncilReport(
  answer: Pick<ChatMessage, "status" | "body"> | undefined,
) {
  return answer?.status === "complete" && Boolean(answer.body.trim());
}

/**
 * A member's latest answer in its main conversation: what it reports. Side
 * conversations, compactions and the notes agents leave each other when the
 * user switches between them in its thread aren't reports.
 */
export function memberAnswer(messages: readonly ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (
      m.role === "assistant" &&
      !m.parentId &&
      !m.compaction &&
      !m.handoff &&
      !m.reload &&
      !m.worktreeCommand
    )
      return m;
  }
}
