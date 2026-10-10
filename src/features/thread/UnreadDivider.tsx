import { useEffect, useRef, useState, type RefObject } from "react";
import { sentLabel } from "../../../shared/chat-activity";
import { useWindowFocused } from "../../lib/window-focus";
import { markArrivalRead } from "./arrival";

/** How long the divider stays once it's been seen. */
const SEEN_FOR = 4000;

type UnreadProps = {
  chatId: string;
  since: number;
  read: boolean;
  scroll: RefObject<HTMLDivElement | null>;
  bottomInset: number;
};

/**
 * Marks the arrival read once `row` has been at least half in view for
 * SEEN_FOR with Relay in front; scrolling it away or leaving the window starts
 * the count again. The view's bottom edge is the composer's top, since the
 * thread scrolls under it.
 */
function useReadWhenSeen(
  row: RefObject<HTMLElement | null>,
  { chatId, read, scroll, bottomInset }: Omit<UnreadProps, "since">,
) {
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
  }, [watching, bottomInset, scroll, row]);
  useEffect(() => {
    if (!watching || !inView) return;
    const timer = setTimeout(() => markArrivalRead(chatId), SEEN_FOR);
    return () => clearTimeout(timer);
  }, [watching, inView, chatId]);
}

function unreadLabel(since: number) {
  const now = new Date();
  const when = sentLabel(since, now);
  return new Date(since).toDateString() === now.toDateString()
    ? `Today ${when}`
    : when;
}

/**
 * The line above the first message you haven't seen: the compaction row's
 * shape in the unread dot's colour. Once seen it fades but keeps its height,
 * so the thread pinned to the bottom doesn't move.
 */
export function UnreadDivider(props: UnreadProps) {
  const row = useRef<HTMLDivElement>(null);
  useReadWhenSeen(row, props);
  const label = unreadLabel(props.since);
  return (
    <div
      ref={row}
      className="unread-divider"
      data-read={props.read || undefined}
      aria-hidden={props.read || undefined}
      role="separator"
      aria-label={label}
    >
      <span>{label}</span>
    </div>
  );
}

/**
 * The divider folded into a row that already draws a line, like an agent
 * switch, so the two don't stack. Once seen the time folds away and the row's
 * own label slides back to the middle.
 */
export function UnreadMark(props: UnreadProps) {
  const mark = useRef<HTMLSpanElement>(null);
  useReadWhenSeen(mark, props);
  return (
    <span
      ref={mark}
      className="unread-mark"
      data-read={props.read || undefined}
      aria-hidden={props.read || undefined}
    >
      <span>
        <span>{unreadLabel(props.since)}</span>
        <span aria-hidden>·</span>
      </span>
    </span>
  );
}
