import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatSummary } from "../../../shared/projects";
import { writeGate } from "./write-gate";

export type ThreadHandle = ReturnType<typeof useThreadHandle>;

/**
 * Which thread the hooks that change it work on, and the gate their writes
 * go through one at a time: a message, a queue edit, a review or council
 * start. While one is out the others don't start, and `busy` says so to the
 * UI; one that fails shows as the thread's `error`, where other failures show too.
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
  // Held outside render state, so writes started before a re-render see each other.
  const [gate] = useState(() =>
    writeGate({ onBusy: setBusy, onError: setError }),
  );
  return {
    chat,
    id,
    projectId,
    refetch,
    busy,
    error,
    setError,
    run: gate.run,
    /** Takes the gate before asking the user something, so no other write starts meanwhile. */
    reserve: gate.reserve,
    /** The project's thread list shows what changed in the thread. */
    listChanged: () =>
      qc.invalidateQueries({ queryKey: ["project-chats", projectId] }),
  };
}
