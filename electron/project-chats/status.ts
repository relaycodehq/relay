import type { ChatSummary, ProjectChat } from "../../shared/projects";
import { inputBlocksThread } from "../../shared/thread-state";
import { sliceWhole } from "../../shared/truncate";

type Progress =
  "working" | "needs-input" | "done" | "stopped" | "failed" | "idle";
const answerStatus = {
  streaming: "working",
  complete: "done",
  cancelled: "stopped",
  failed: "failed",
} as const;

/** A thread's progress, without handing out its messages, attachments or traces. */
export function chatStatus(summary: ChatSummary, chat: ProjectChat) {
  let last: ProjectChat["messages"][number] | undefined;
  const asks = chat.requests?.map((r) => r.title) ?? [];
  for (const message of chat.messages) {
    if (message.role === "assistant" && !message.parentId) last = message;
    for (const group of message.questions ?? [])
      if (!group.answers && !group.dismissed)
        asks.push(...group.questions.map((q) => q.question));
  }
  let status: Progress;
  if (inputBlocksThread(summary)) status = "needs-input";
  else if (
    summary.running ||
    summary.pending?.length ||
    (chat.queue?.length && !chat.queuePaused)
  )
    status = "working";
  else if (last) status = answerStatus[last.status];
  else status = chat.messages.length ? "working" : "idle";
  return {
    summary: structuredClone(summary),
    status,
    ...(asks.length ? { asks } : {}),
    ...(chat.worktree?.path && !summary.sentTo
      ? { folder: chat.worktree.path }
      : {}),
    ...(last?.body
      ? {
          latest:
            last.body.length > 600
              ? `…${sliceWhole(last.body, -600)}`
              : last.body,
        }
      : {}),
    ...(last?.error ? { error: last.error } : {}),
  };
}

export type ChatStatus = ReturnType<typeof chatStatus>;
