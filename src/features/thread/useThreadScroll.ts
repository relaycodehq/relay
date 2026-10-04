import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../../shared/projects";

/** A message in the view, and how far below the top of the view it starts. */
type ReadingPlace = { id: string; offset: number };
/** Where the reader left each thread they scrolled up in, by the message at
 * the top of the view. Heights above it are estimates after a switch, so a
 * pixel offset would land somewhere else. Threads left at the bottom have no
 * entry and open pinned there. */
const readingPlaces = new Map<string, ReadingPlace>();
/** A thread opens with the latest few messages mounted and fills up to the
 * window on idle, so the first paint isn't waiting on 80 markdown renders. */
const FIRST_MESSAGES = 20,
  MESSAGE_WINDOW = 80,
  MESSAGE_STEP = 20;
/** The message at the top of the thread's view, and how far below it starts. */
function placeInView(view: HTMLElement): ReadingPlace | undefined {
  const top = view.getBoundingClientRect().top;
  for (const m of view.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const box = m.getBoundingClientRect();
    if (box.bottom > top)
      return { id: m.dataset.messageId!, offset: box.top - top };
  }
}
/** Scrolls a message back to its place in the view; false if it isn't shown. */
function scrollToPlace(view: HTMLElement, { id, offset }: ReadingPlace) {
  const message = view.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  if (!message) return false;
  view.scrollTop +=
    message.getBoundingClientRect().top -
    view.getBoundingClientRect().top -
    offset;
  return true;
}

export type ThreadScroll = ReturnType<typeof useThreadScroll>;

/** Keeps a thread pinned to its newest answer until the reader scrolls up,
 * then holds what they read, here and when they come back to the thread.
 * Only the latest messages are mounted; `visible` is how many. */
export function useThreadScroll({
  place,
  rootId,
  messages,
  shown,
  opened,
  isEmpty,
}: {
  /** The thread and side conversation being read; each keeps its own place. */
  place: string;
  /** Opening or leaving a side conversation re-pins, or re-holds the place. */
  rootId: string | null;
  /** All of the thread's messages: any change re-pins, or re-holds the place. */
  messages: ChatMessage[];
  /** The messages the view lists, oldest first. */
  shown: ChatMessage[];
  /** The history has arrived, so a held message missing from it is gone. */
  opened: boolean;
  /** The view and the composer dock are laid out anew when this flips. */
  isEmpty: boolean;
}) {
  const [visible, setVisible] = useState(FIRST_MESSAGES);
  const scroll = useRef<HTMLDivElement>(null),
    column = useRef<HTMLDivElement>(null),
    composerDock = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    returning = useRef<ReadingPlace | undefined>(undefined),
    // Where holding that message left the scroll; a scroll elsewhere is the reader's.
    placed = useRef(0),
    lastTop = useRef(0),
    oldest = useRef<string | undefined>(undefined);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [dockHeight, setDockHeight] = useState(0);
  useLayoutEffect(() => {
    returning.current = readingPlaces.get(place);
    follow.current = !returning.current;
    oldest.current = undefined;
    setVisible(FIRST_MESSAGES);
  }, [place]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const back = returning.current;
    // Sending a message pins the thread instead.
    if (back && !follow.current) {
      // Held there until the reader scrolls; see the observer below.
      if (scrollToPlace(el, back)) {
        placed.current = el.scrollTop;
        return;
      }
      // Further back than the latest messages: show enough to reach it.
      const index = shown.findIndex((m) => m.id === back.id);
      if (index >= 0) {
        setVisible(shown.length - index);
        return;
      }
      // Still opening, or that message is gone: then the bottom it is.
      if (!opened) return;
      readingPlaces.delete(place);
      follow.current = true;
    }
    returning.current = undefined;
    if (follow.current) el.scrollTop = el.scrollHeight;
  }, [messages, rootId, visible]);
  // Up the thread, new messages would push the oldest ones shown out from
  // under the reader: keep showing from the same message until they follow.
  useLayoutEffect(() => {
    const index = shown.findIndex((m) => m.id === oldest.current);
    if (!follow.current && index >= 0 && shown.length - index > visible) {
      setVisible(shown.length - index);
      return;
    }
    oldest.current = shown[Math.max(0, shown.length - visible)]?.id;
  }, [shown, visible]);
  const filling = visible < MESSAGE_WINDOW && shown.length > visible;
  useEffect(() => {
    if (!filling) return;
    const idle = requestIdleCallback(
      () => {
        // Going in above a reader who has scrolled up: hold their message.
        const view = scroll.current;
        if (view && !follow.current && !returning.current)
          returning.current = placeInView(view);
        setVisible((v) => Math.min(v + MESSAGE_STEP, MESSAGE_WINDOW));
      },
      { timeout: 250 },
    );
    return () => cancelIdleCallback(idle);
  }, [filling, visible]);
  useEffect(() => {
    const dock = composerDock.current;
    if (!dock) return;
    // Messages scroll underneath the composer, so they need bottom padding as
    // tall as it. While it is folded away the padding only grows: shrinking it
    // would pull the reader back toward the bottom, but a prompt typed into
    // the folded composer, or a card above it, still has to leave the end of
    // the thread readable. Unfolding re-observes, which measures it exactly.
    const observer = new ResizeObserver(() => {
      const height = dock.offsetHeight;
      setDockHeight((h) => (scrolledUp ? Math.max(h, height) : height));
    });
    observer.observe(dock);
    return () => observer.disconnect();
  }, [isEmpty, scrolledUp]);
  // The padding lands a render after the measurement, and a thread opens with
  // none, so re-pin once it has. Pinning before it would leave the end of the
  // thread under the composer, and the next scroll event would stop following.
  useLayoutEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [dockHeight]);
  useEffect(() => {
    const content = column.current;
    if (!content) return;
    // Messages grow after they render: off-screen ones swap their estimated
    // height for the real one, and images and code load late. Stay pinned,
    // or keep the message the reader came back to where it was: the ones
    // around it only take their real heights a frame after it's placed.
    // At fractional zoom the column's height wobbles by a fraction of a pixel
    // as the reader scrolls; re-pinning on that holds them at the bottom.
    let height = 0;
    const observer = new ResizeObserver(([entry]) => {
      const el = scroll.current;
      const next = entry!.borderBoxSize[0]!.blockSize;
      if (!el || Math.abs(next - height) < 1) return;
      height = next;
      if (follow.current) el.scrollTop = el.scrollHeight;
      else if (returning.current && scrollToPlace(el, returning.current))
        placed.current = el.scrollTop;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [isEmpty]);
  function onScroll() {
    const e = scroll.current!;
    const distance = e.scrollHeight - e.scrollTop - e.clientHeight;
    // Going by distance alone, a small step up while an answer
    // streams stays near the bottom and the next piece pulls the
    // reader back. Any step up lets go; coming back down resumes.
    // Pinning only moves down, and content shrinking at the bottom
    // leaves no distance, so neither lets go by itself.
    if (e.scrollTop < lastTop.current - 1 && distance > 1)
      follow.current = false;
    else if (e.scrollTop > lastTop.current && distance < 80)
      follow.current = true;
    lastTop.current = e.scrollTop;
    setScrolledUp(distance > 160);
    // Holding a message in place scrolls too; the reader scrolling
    // anywhere else lets it go.
    if (returning.current) {
      // Within a pixel: some screens report back a rounded position.
      if (Math.abs(e.scrollTop - placed.current) < 1) return;
      returning.current = undefined;
    }
    if (follow.current) {
      readingPlaces.delete(place);
      return;
    }
    const top = placeInView(e);
    if (top) readingPlaces.set(place, top);
  }
  return {
    /** The scrolling view, its message column, and the composer docked over it. */
    scroll,
    column,
    composerDock,
    onScroll,
    /** How many of the latest shown messages are mounted. */
    visible,
    /** Older messages wait behind a button; the idle fill isn't coming for them. */
    earlier: shown.length > visible && !filling,
    showEarlier() {
      // They go in above the message being read, which stays put.
      returning.current = placeInView(scroll.current!);
      setVisible((v) => v + MESSAGE_WINDOW);
    },
    /** The reader is far enough up that the composer folds away. */
    scrolledUp,
    /** The expanded composer's height, which the view pads its end by. */
    dockHeight,
    /** Something was sent: pin to the bottom for its answer. */
    followAnswer() {
      follow.current = true;
    },
  };
}
