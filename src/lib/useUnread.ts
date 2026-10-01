import { useEffect, useRef, useState } from "react";
import { movedSinceSeen } from "../../shared/chat-activity";
import type { ChatSummary } from "../../shared/projects";
import { readJson, writeJson } from "./persisted-store";
import { useWindowFocused } from "./window-focus";

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
  const [seen, setSeen] = useState<Record<string, number>>(() => {
    const saved = readJson("relay-thread-seen");
    return saved && typeof saved === "object"
      ? (saved as Record<string, number>)
      : {};
  });
  const current = chats.find((c) => c.id === chatId);
  /** The thread last read here; marking it unread while it's open holds until it's opened again. */
  const opened = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!current) {
      opened.current = undefined;
      return;
    }
    if (!focused) return;
    const reopened = opened.current !== current.id;
    opened.current = current.id;
    if (
      !(current.markedUnread && reopened) &&
      (seen[current.id] ?? 0) >= current.updated
    )
      return;
    setSeen((s) => {
      const next = { ...s, [current.id]: current.updated };
      writeJson("relay-thread-seen", next);
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
