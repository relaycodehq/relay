import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatSummary } from "../../shared/projects";

export type ThreadHandle = ReturnType<typeof useThreadHandle>;

/**
 * Which thread the hooks that change it work on, and the gate their writes
 * go through one at a time: a message, a queue edit, a review or council
 * start. While one is out `busy` holds the others off; one that fails shows
 * as the thread's `error`, where other failures show too.
 */
export function useThreadHandle(
  chat: ChatSummary | undefined,
  /** The thread's id, or the unsent one's; see lib/drafts. */
  id: string,
  projectId: string,
  /** Fetches the thread's messages again. */
  refetch: () => Promise<unknown>,
) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  /** Resolves to whether `work` went through. Callers check `busy` first. */
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    chat,
    id,
    projectId,
    refetch,
    busy,
    error,
    setError,
    run,
    /** The project's thread list shows what changed in the thread. */
    listChanged: () =>
      qc.invalidateQueries({ queryKey: ["project-chats", projectId] }),
  };
}
