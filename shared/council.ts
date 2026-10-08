import type { ChatMessage } from "./projects";

/** A council member is finished only when it supplied a written report. */
export function hasCouncilReport(
  answer: Pick<ChatMessage, "status" | "body"> | undefined,
) {
  return answer?.status === "complete" && Boolean(answer.body.trim());
}
