import { useEffect, useRef, useState } from "react";
import {
  movedSinceSeen,
  openedUpTo,
  readUpTo,
} from "../../../shared/chat-activity";
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

/** The threads that have been read here. */
export const seenThreads = () => Object.keys(savedSeen());

/** Forgets when `gone` threads were read, so the marks don't pile up. */
export function forgetSeen(gone: string[]) {
  if (!gone.length) return;
  const seen = savedSeen();
  for (const id of gone) delete seen[id];
  writeJson(SEEN, seen);
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
  // Read on past the wake time when it comes while you're looking.
  const [woke, setWoke] = useState(0);
  const wakesAt = current?.snoozedUntil;
  useEffect(() => {
    if (!focused || !wakesAt || wakesAt <= Date.now()) return;
    const timer = setTimeout(
      () => setWoke((n) => n + 1),
      Math.min(wakesAt + 1 - Date.now(), 2 ** 31 - 1),
    );
    return () => clearTimeout(timer);
  }, [focused, wakesAt, woke]);
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
    const now = Date.now();
    noteArrival({
      chatId: current.id,
      readTo: readUpTo(current, since, seen),
      updated: current.updated,
      now,
      opened: reopened,
      refocused,
    });
    // A woken thread reads past its wake time, so "Woke up" clears.
    const upTo = openedUpTo(current, now);
    if (!(current.markedUnread && reopened) && (seen[current.id] ?? 0) >= upTo)
      return;
    setSeen(() => {
      // Storage has what every window read, and not the threads swept as gone.
      const next = savedSeen();
      next[current.id] = Math.max(next[current.id] ?? 0, upTo);
      writeJson(SEEN, next);
      return next;
    });
    // Phones read it from the desktop, so their marks clear too.
    void window.relay
      ?.markProjectChatSeen?.(current.id, upTo)
      .catch(() => {});
  }, [focused, current?.id, current?.updated, current?.snoozedUntil, woke]);
  return (c: ChatSummary) =>
    ((c.id !== chatId || (!focused && !c.running)) && !!c.markedUnread) ||
    movedSinceSeen(c, since, seen);
}
