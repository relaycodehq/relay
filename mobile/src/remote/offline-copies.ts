// Saves the latest threads for reading offline before they're opened, so a
// train or a sleeping computer leaves more than the threads read on the phone.
import { useEffect } from "react";
import { remoteHistory } from "../../../shared/remote";
import { applyPatch, knownOf } from "./chat-state";
import { copiedAhead, loadThread, saveThread, threadStale } from "./offline";
import { useRemote } from "./RemoteProvider";

/** Thread id → the summary's `updated` it was saved at, this session. */
const copied = new Map<string, number>();
/** Quiet time after the list moves, so a burst of changes costs one pass. */
const settle = 3_000;

export function useOfflineCopies() {
  const { status, overview, call } = useRemote();
  const chats = overview?.chats;
  useEffect(() => {
    if (status !== "online" || !chats) return;
    let live = true;
    const due = [...chats]
      .sort((a, b) => b.updated - a.updated)
      .slice(0, copiedAhead)
      // A running one changes by the second; it's saved once it stops.
      .filter((c) => !c.running && (copied.get(c.id) ?? 0) < c.updated && threadStale(c.id, c.updated));
    if (!due.length) return;
    const timer = setTimeout(async () => {
      for (const c of due) {
        if (!live) return;
        try {
          // Only what changed travels: the saved copy's messages go as known.
          const saved = await loadThread(c.id);
          const patch = await call("chat", c.id, knownOf(saved), remoteHistory);
          let thread;
          try {
            thread = applyPatch(saved, patch);
          } catch {
            thread = applyPatch(undefined, await call("chat", c.id, undefined, remoteHistory));
          }
          saveThread(c.id, thread);
          copied.set(c.id, c.updated);
        } catch {
          // Lost the link or the thread; the next pass tries again.
          return;
        }
      }
    }, settle);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [status, chats, call]);
}
