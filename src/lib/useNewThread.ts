import { useRef } from "react";
import type { ChatSummary } from "../../shared/projects";

export type NewThread = ReturnType<typeof useNewThread>;

/**
 * The thread an unsent one turns into, made by the first write to it. A write
 * that fails keeps the thread, so the next try goes there instead of making
 * another; one that goes through opens it in the unsent one's place.
 */
export function useNewThread(
  create: () => Promise<ChatSummary>,
  onCreated: (c: ChatSummary) => Promise<void>,
) {
  const made = useRef<ChatSummary | undefined>(undefined);
  return async (write: (thread: ChatSummary) => Promise<void>) => {
    const thread = (made.current ??= await create());
    await write(thread);
    await onCreated(thread);
  };
}
