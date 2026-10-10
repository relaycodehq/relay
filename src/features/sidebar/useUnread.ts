import { useEffect, useRef, useState } from "react";
import { movedSinceSeen, readUpTo } from "../../../shared/chat-activity";
import type { ChatSummary } from "../../../shared/projects";
import { readJson, writeJson } from "../../lib/persisted-store";
import { useWindowFocused } from "../../lib/window-focus";
import { clearArrival, noteArrival } from "../thread/arrival";

const SEEN = "relay-thread-seen";

function savedSeen(): Record<string, number> {
  const saved = readJson(SEEN);
  return saved && typeof saved === "object"
    ? (saved as Record<string, number>)
    : {};
}

/**
 * Last time each thread was open here; drives the unread dot. The open thread
 * only counts as seen while Relay is in front: an answer that lands while
 * you're in another app stays unread until you come back.
 */
export function useUnread(chatId: string | undefined, chats: ChatSummary[]) {
  const focused = useWindowFocused();
  const [since] = useState(() => {
    const saved = Number(localStorage.getItem("relay-thread-seen-since"));
    if (saved > 0) return saved;
    const now = Date.now();
    localStorage.setItem("relay-thread-seen-since", String(now));
    return now;
  });
  const [seen, setSeen] = useState(savedSeen);
  // A thread read in its own window counts as read here too.
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.key === SEEN) setSeen(savedSeen());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const current = chats.find((c) => c.id === chatId);
  /** The thread last read here; marking it unread while it's open holds until it's opened again. */
  const opened = useRef<string | undefined>(undefined);
  const wasFocused = useRef(focused);
  useEffect(() => {
    const refocused = focused && !wasFocused.current;
    wasFocused.current = focused;
    if (!current) {
      opened.current = undefined;
      clearArrival();
      return;
    }
    if (!focused) return;
    const reopened = opened.current !== current.id;
    opened.current = current.id;
    // Before it's marked read below: the thread's "New" divider goes where
    // you had read up to.
    noteArrival({
      chatId: current.id,
      readTo: readUpTo(current, since, seen),
      updated: current.updated,
      now: Date.now(),
      opened: reopened,
      refocused,
    });
    if (
      !(current.markedUnread && reopened) &&
      (seen[current.id] ?? 0) >= current.updated
    )
      return;
    setSeen((s) => {
      // Another window may have read threads since this one last looked.
      const next = { ...s, [current.id]: current.updated };
      for (const [id, at] of Object.entries(savedSeen()))
        next[id] = Math.max(next[id] ?? 0, at);
      writeJson(SEEN, next);
      return next;
    });
    // Phones read it from the desktop, so their marks clear too.
    void window.relay
      ?.markProjectChatSeen?.(current.id, current.updated)
      .catch(() => {});
  }, [focused, current?.id, current?.updated]);
  return (c: ChatSummary) =>
    ((c.id !== chatId || (!focused && !c.running)) && !!c.markedUnread) ||
    movedSinceSeen(c, since, seen);
}
