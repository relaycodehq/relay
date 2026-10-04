import { useEffect, useRef, useState, type RefObject } from "react";
import { sentLabel } from "../../../shared/chat-activity";
import { useWindowFocused } from "../../lib/window-focus";
import { markArrivalRead } from "./arrival";

/** How long the divider stays once it's been seen. */
const SEEN_FOR = 4000;

/**
 * The line above the first message you haven't seen. Once it has been at
 * least half in view for SEEN_FOR with Relay in front, it fades but keeps its
 * height, so the thread pinned to the bottom doesn't move; scrolling it away
 * or leaving the window starts the count again. The view's bottom edge is the
 * composer's top, since the thread scrolls under it.
 */
export function UnreadDivider({
  chatId,
  since,
  read,
  scroll,
  bottomInset,
}: {
  chatId: string;
  since: number;
  read: boolean;
  scroll: RefObject<HTMLDivElement | null>;
  bottomInset: number;
}) {
  const row = useRef<HTMLDivElement>(null);
  const focused = useWindowFocused();
  const [inView, setInView] = useState(false);
  const watching = focused && !read;
  useEffect(() => {
    const el = row.current;
    if (!watching || !el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry!.intersectionRatio >= 0.5),
      {
        root: scroll.current,
        rootMargin: `0px 0px -${bottomInset}px 0px`,
        threshold: 0.5,
      },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      setInView(false);
    };
  }, [watching, bottomInset, scroll]);
  useEffect(() => {
    if (!watching || !inView) return;
    const timer = setTimeout(() => markArrivalRead(chatId), SEEN_FOR);
    return () => clearTimeout(timer);
  }, [watching, inView, chatId]);
  const now = new Date();
  const when = sentLabel(since, now).replace(/^Yesterday/, "yesterday");
  const today = new Date(since).toDateString() === now.toDateString();
  const label = `New since ${today ? `today, ${when}` : when}`;
  return (
    <div
      ref={row}
      className="unread-divider"
      data-read={read || undefined}
      aria-hidden={read || undefined}
      role="separator"
      aria-label={label}
    >
      <span>{label}</span>
    </div>
  );
}
