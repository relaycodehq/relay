import { useEffect, useRef, useState } from "react";
import type { Presence, RoomMessage } from "../../shared/rooms";
import type { Pull } from "../../shared/types";
import { api } from "./api";

/**
 * A PR room's messages and who's in it, polled while the room is open. The
 * transcript follows new messages while it's scrolled to the bottom, and
 * otherwise says there's new activity.
 */
export function useRoomFeed(pull: Pull, roomId: string | undefined) {
  const [messages, setMessages] = useState<RoomMessage[]>([]),
    [presence, setPresence] = useState<Presence[]>([]),
    [networkError, setNetworkError] = useState(false),
    [more, setMore] = useState(false),
    [newMessages, setNewMessages] = useState(false);
  const viewport = useRef<HTMLDivElement>(null),
    cursor = useRef(0),
    follow = useRef(true);
  useEffect(() => {
    if (!roomId) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const page = await api.roomPoll(pull, cursor.current);
        if (!active) return;
        setMessages((old) => {
          if (!page.messages.length) return old;
          const map = new Map(old.map((m) => [m.id, m]));
          for (const m of page.messages) map.set(m.id, m);
          return [...map.values()].sort((a, b) => a.order - b.order);
        });
        if (cursor.current === 0) setMore(page.more);
        cursor.current = page.cursor;
        setPresence((old) =>
          JSON.stringify(old.map(({ at, ...p }) => p)) ===
          JSON.stringify(page.presence.map(({ at, ...p }) => p))
            ? old
            : page.presence,
        );
        setNetworkError(false);
        if (page.messages.length) {
          if (follow.current)
            requestAnimationFrame(() => {
              viewport.current?.scrollTo({
                top: viewport.current.scrollHeight,
              });
            });
          else setNewMessages(true);
        }
        timer = setTimeout(
          poll,
          page.more && page.messages.length === 100 ? 50 : 1200,
        );
      } catch {
        if (active) {
          setNetworkError(true);
          timer = setTimeout(poll, 3500);
        }
      } finally {
        polling = false;
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [roomId]);
  /** Prepends the page before the oldest message, keeping the view in place. */
  async function loadEarlier() {
    const el = viewport.current!,
      height = el.scrollHeight;
    const page = await api.roomPoll(pull, 0, messages[0]?.order);
    setMessages((old) =>
      [...page.messages, ...old].filter(
        (m, i, a) => a.findIndex((x) => x.id === m.id) === i,
      ),
    );
    setMore(page.more);
    requestAnimationFrame(() => {
      el.scrollTop += el.scrollHeight - height;
    });
  }
  function onScroll() {
    const el = viewport.current!;
    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (follow.current) setNewMessages(false);
  }
  function jumpToLatest() {
    follow.current = true;
    viewport.current?.scrollTo({
      top: viewport.current.scrollHeight,
      behavior: "smooth",
    });
    setNewMessages(false);
  }
  return {
    viewport,
    messages,
    presence,
    networkError,
    /** Older messages wait above the first page. */
    more,
    newMessages,
    loadEarlier,
    onScroll,
    jumpToLatest,
    /** Follows the next message in, as after sending one. */
    followLatest: () => {
      follow.current = true;
    },
    /** Starts over, as after leaving the room. */
    clear: () => {
      setMessages([]);
      cursor.current = 0;
    },
  };
}
export type RoomFeed = ReturnType<typeof useRoomFeed>;
