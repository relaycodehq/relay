import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import type { ChatMessage } from "../../../shared/projects";

/** A message in the view, and how far below the top of the view it starts. */
type ReadingPlace = { id: string; offset: number };
/** Where the reader left each thread they scrolled up in, by the message at
 * the top of the view. Heights above it are estimates after a switch, so a
 * pixel offset would land somewhere else. Threads left at the bottom have no
 * entry and open pinned there. */
const readingPlaces = new Map<string, ReadingPlace>();
/** A thread opens with the latest few messages mounted, more only if they
 * don't fill the view, and fills up to the window on idle, so a switch
 * isn't waiting on 80 markdown renders. */
const FIRST_MESSAGES = 6,
  MESSAGE_WINDOW = 80,
  MESSAGE_STEP = 20;
/** The unfolded composer's height in the thread last open. Another thread
 * opens padded for it, so it needn't render a second time once measured. */
let lastDockHeight = 0;
/** A message jumped to lands this far below the top of the view. */
const JUMP_OFFSET = 12;
/** How long a message or passage jumped to stays lit, matching their CSS animations. */
export const FLASH_MS = 1400;

/** Lights message `id` up once it's in `view`, which may take a render or two. */
function flashWhenShown(view: { current: HTMLElement | null }, id: string) {
  let frames = 0;
  const look = () => {
    const message = view.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(id)}"]`,
    );
    if (!message) {
      if (++frames < 60) requestAnimationFrame(look);
      return;
    }
    // Again on a message still lit starts it over.
    delete message.dataset.flash;
    void message.offsetWidth;
    message.dataset.flash = "";
    // A timer, not animationend: with reduced motion there's no animation to end.
    setTimeout(() => delete message.dataset.flash, FLASH_MS);
  };
  requestAnimationFrame(look);
}

/** The message at the top of the thread's view, and how far below it starts. */
function placeInView(view: HTMLElement): ReadingPlace | undefined {
  const top = view.getBoundingClientRect().top;
  for (const m of view.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const box = m.getBoundingClientRect();
    if (box.bottom > top)
      return { id: m.dataset.messageId!, offset: box.top - top };
  }
}

/** Lay out the message being positioned before reading its geometry. */
function layoutAnchor(view: HTMLElement, message: Element) {
  // A skipped message still has its estimated height. Restoring inside a
  // tall answer can clamp to it; pinning below a short last answer can leave
  // it too high. Both need the target's real size before the first paint.
  const previous = view.querySelector("[data-reading-anchor]");
  if (previous !== message) {
    previous?.removeAttribute("data-reading-anchor");
    message.setAttribute("data-reading-anchor", "");
  }
  return message.getBoundingClientRect();
}

/** Scrolls a message back to its place in the view; false if it isn't shown. */
function scrollToPlace(view: HTMLElement, { id, offset }: ReadingPlace) {
  const message = view.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  if (!message) return false;
  const delta =
    layoutAnchor(view, message).top - view.getBoundingClientRect().top - offset;
  view.scrollTop += delta;
  return true;
}

function pinToBottom(view: HTMLElement) {
  // Dividers after the answer already have their real height; the last
  // ordinary message is the one whose skipped layout can move its text.
  const messages = view.querySelectorAll(
    ".thread-message-column > .project-message",
  );
  const last = messages[messages.length - 1];
  if (last) layoutAnchor(view, last);
  view.scrollTop = view.scrollHeight;
}

/**
 * The folded composer shows the draft's first line, not wherever the caret
 * last scrolled it to.
 */
function useDraftFromItsTop(composerDock: RefObject<HTMLDivElement | null>, folded: boolean) {
  useEffect(() => {
    const dock = composerDock.current;
    if (!dock || !folded) return;
    const toTop = (event?: FocusEvent) => {
      const next = event ? event.relatedTarget : document.activeElement;
      if (next instanceof Node && dock.contains(next)) return;
      dock.querySelector(".composer-prompt-input")?.scrollTo({ top: 0 });
    };
    toTop();
    dock.addEventListener("focusout", toTop);
    return () => dock.removeEventListener("focusout", toTop);
  }, [composerDock, folded]);
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
  const following = useCallback(() => follow.current, []);
  const [dockHeight, setDockHeight] = useState(() =>
    isEmpty ? 0 : lastDockHeight,
  );
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
    if (!follow.current) return;
    pinToBottom(el);
    // Short messages may not reach the top of a tall view: mount more before
    // it paints, rather than show a gap until the idle fill.
    if (el.scrollTop <= 0 && shown.length > visible && visible < MESSAGE_WINDOW)
      setVisible((v) => Math.min(v + FIRST_MESSAGES, MESSAGE_WINDOW));
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
  useLayoutEffect(() => {
    const dock = composerDock.current;
    if (!dock) return;
    // Messages scroll underneath the composer, so they need bottom padding as
    // tall as it. While it is folded away, or still unfolding, the padding
    // only grows: shrinking it would move the thread under the reader, and
    // pin them to the bottom as it grew back. A prompt typed into the folded
    // composer, or a card above it, still has to leave the end of the thread
    // readable. Once unfolded it's measured exactly.
    const measure = () => {
      const height = dock.offsetHeight;
      // Frosted chat fades the thread out above the composer; that edge
      // follows the composer as it folds, frame by frame, unlike the padding.
      scroll.current?.style.setProperty("--composer-dock-live", `${height}px`);
      const folding = dock
        .querySelector(".composer-prompt-input")
        ?.getAnimations()
        .some((a) => a instanceof CSSTransition);
      if (!isEmpty && !scrolledUp && !folding) lastDockHeight = height;
      setDockHeight((h) =>
        scrolledUp || folding ? Math.max(h, height) : height,
      );
    };
    // The first paint needs the composer's full space too. Waiting for the
    // observer would paint the thread at the bottom with no padding, then
    // move it up a frame later when the measured height reaches React.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    dock.addEventListener("transitionend", measure);
    return () => {
      observer.disconnect();
      dock.removeEventListener("transitionend", measure);
    };
  }, [isEmpty, scrolledUp]);
  useDraftFromItsTop(composerDock, scrolledUp);
  // The padding lands a render after the measurement, and a thread opens with
  // none, so re-pin once it has. Pinning before it would leave the end of the
  // thread under the composer, and the next scroll event would stop following.
  useLayoutEffect(() => {
    if (follow.current && scroll.current) pinToBottom(scroll.current);
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
    const heights = new Map<Element, number>();
    const observer = new ResizeObserver((entries) => {
      const el = scroll.current;
      if (!el) return;
      let changed = false;
      for (const entry of entries) {
        const next = entry.borderBoxSize[0]!.blockSize;
        if (Math.abs(next - (heights.get(entry.target) ?? 0)) < 1) continue;
        heights.set(entry.target, next);
        changed = true;
      }
      if (!changed) return;
      if (follow.current) pinToBottom(el);
      else if (returning.current) {
        if (scrollToPlace(el, returning.current)) placed.current = el.scrollTop;
      } else {
        // Lazy layout can move the messages without another scroll event.
        // Save where the reader is now, rather than where that event left them.
        const top = placeInView(el);
        if (top) readingPlaces.set(place, top);
      }
    });
    observer.observe(content);
    // Resizing the terminal or window changes the view without changing the
    // messages. Keep following now, before another answer snaps it back.
    if (scroll.current) observer.observe(scroll.current);
    return () => observer.disconnect();
  }, [isEmpty, place]);
  function onScroll() {
    const e = scroll.current!;
    const distance = e.scrollHeight - e.scrollTop - e.clientHeight;
    // Holding a message in place scrolls too; it mustn't resume following.
    // Within a pixel: some screens report back a rounded position.
    const held =
      returning.current && Math.abs(e.scrollTop - placed.current) < 1;
    // Going by distance alone, a small step up while an answer
    // streams stays near the bottom and the next piece pulls the
    // reader back. Any step up lets go; coming back down resumes.
    // Pinning only moves down, and content shrinking at the bottom
    // leaves no distance, so neither lets go by itself.
    if (!held) {
      if (e.scrollTop < lastTop.current - 1 && distance > 1)
        follow.current = false;
      else if (e.scrollTop > lastTop.current && distance < 80)
        follow.current = true;
    }
    lastTop.current = e.scrollTop;
    setScrolledUp(distance > 160);
    if (held) return;
    // The reader scrolling anywhere else lets the held message go.
    returning.current = undefined;
    // A programmatic scroll at the bottom must keep its last message laid
    // out; removing the marker before paint brings its estimate back.
    if (!follow.current)
      e.querySelector("[data-reading-anchor]")?.removeAttribute(
        "data-reading-anchor",
      );
    if (follow.current) {
      readingPlaces.delete(place);
      return;
    }
    const top = placeInView(e);
    if (top) readingPlaces.set(place, top);
  }
  /** Brings message `id` to the top of the view, or `offset` below it,
   * mounting back to it if it is further up than the messages shown, and
   * holds it there. */
  function jumpTo(id: string, { flash = false, offset = JUMP_OFFSET } = {}) {
    const view = scroll.current,
      index = shown.findIndex((m) => m.id === id);
    if (!view || index < 0) return;
    follow.current = false;
    returning.current = { id, offset };
    if (shown.length - index > visible) setVisible(shown.length - index);
    else if (scrollToPlace(view, returning.current))
      placed.current = view.scrollTop;
    // Mounted but not drawn: there's nowhere to hold.
    else returning.current = undefined;
    if (flash) flashWhenShown(scroll, id);
  }
  return {
    /** The scrolling view, its message column, and the composer docked over it. */
    scroll,
    column,
    composerDock,
    onScroll,
    /** Inspecting details holds the reader's place before their height changes,
     * including keyboard clicks and native details/summary disclosures. */
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      const view = scroll.current;
      const disclosure =
        event.target instanceof Element &&
        event.target.closest("summary, button[aria-expanded]");
      if (!view || !disclosure || !view.contains(disclosure)) return;
      const message = disclosure.closest<HTMLElement>("[data-message-id]");
      if (!message) return;
      follow.current = false;
      returning.current = {
        id: message.dataset.messageId!,
        offset:
          message.getBoundingClientRect().top -
          view.getBoundingClientRect().top,
      };
      placed.current = view.scrollTop;
      readingPlaces.set(place, returning.current);
    },
    /** How many of the latest shown messages are mounted. */
    visible,
    /** Older messages wait behind a button; the idle fill isn't coming for them. */
    earlier: shown.length > visible && !filling,
    showEarlier() {
      // They go in above the message being read, which stays put.
      returning.current = placeInView(scroll.current!);
      setVisible((v) => v + MESSAGE_WINDOW);
    },
    /** Mounts back far enough to draw message `id`, without moving the view. */
    mountBackTo(id: string) {
      const index = shown.findIndex((m) => m.id === id);
      if (index < 0 || shown.length - index <= visible) return;
      if (!follow.current) returning.current = placeInView(scroll.current!);
      setVisible(shown.length - index);
    },
    jumpTo,
    /** Brings a passage of shown message `id` a third of the way down the
     * view, or the message to the top when the passage starts near it. */
    jumpToPassage(id: string, passage: Range) {
      const view = scroll.current,
        message = view?.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
      if (!view || !message) return;
      const into =
        passage.getBoundingClientRect().top -
        message.getBoundingClientRect().top;
      jumpTo(id, {
        offset: Math.min(JUMP_OFFSET, view.clientHeight / 3 - into),
      });
    },
    /** Opens the view at `to` on message `id`, lit, for a jump that has to
     * switch conversations first. */
    jumpInto(to: string, id: string) {
      readingPlaces.set(to, { id, offset: JUMP_OFFSET });
      flashWhenShown(scroll, id);
    },
    /** The reader is far enough up that the composer folds away. */
    scrolledUp,
    /** The expanded composer's height, which the view pads its end by. */
    dockHeight,
    /** Whether the view is pinned to the thread's end, as it is until the reader scrolls up. */
    following,
    /** Something was sent: pin to the bottom for its answer. */
    followAnswer() {
      follow.current = true;
    },
  };
}
