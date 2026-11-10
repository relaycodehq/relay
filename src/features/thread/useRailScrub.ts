import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { atThreadEnd, railPlace, type RailPlace } from "./rail-scrub";
import type { TimelineTurn } from "./timeline";
import { JUMP_OFFSET, type ThreadScroll } from "./useThreadScroll";

/** How far a press moves before it's a drag rather than a click. */
const DRAG_START = 3;

function contentTop(view: HTMLElement, id: string) {
  const message = view.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  if (!message) return undefined;
  return (
    message.getBoundingClientRect().top -
    view.getBoundingClientRect().top +
    view.scrollTop
  );
}

/**
 * Brings the view to `place`: the turn's prompt at the top as a click puts
 * it, moved `through` of the way toward where the next prompt, or the
 * thread's end, would sit.
 */
function scrollToRailPlace(
  view: HTMLElement,
  turns: TimelineTurn[],
  place: RailPlace,
  thread: Pick<ThreadScroll, "jumpTo" | "followAnswer">,
) {
  if (atThreadEnd(place, turns.length)) {
    // The end is now: follow what's still being written, as scrolling there would.
    thread.followAnswer();
    view.scrollTop = view.scrollHeight;
    return;
  }
  const { id } = turns[place.turn]!;
  const from = contentTop(view, id);
  // Further up than the messages mounted: mount it, and measure next frame.
  if (from === undefined) return thread.jumpTo(id);
  const next = turns[place.turn + 1];
  const nextTop = next && contentTop(view, next.id);
  const start = from - JUMP_OFFSET;
  const stop =
    nextTop === undefined
      ? view.scrollHeight - view.clientHeight
      : nextTop - JUMP_OFFSET;
  const target = start + (stop - start) * place.through;
  thread.jumpTo(id, { offset: from - target });
}

/**
 * Press, hold and drag along the rail to scroll the thread under the
 * pointer, a frame at a time. A press that doesn't move stays a click.
 */
export function useRailScrub({
  rail,
  pitch,
  turns,
  view,
}: {
  rail: RefObject<HTMLDivElement | null>;
  pitch: number;
  turns: TimelineTurn[];
  view: Pick<ThreadScroll, "scroll" | "jumpTo" | "followAnswer">;
}) {
  const [scrubbing, setScrubbing] = useState(false);
  // Where the button went down, while it's down.
  const pressY = useRef<number | null>(null);
  // The last press became a drag, so the click it ends with is no jump.
  const dragged = useRef(false);
  const pendingY = useRef(0);
  const frame = useRef(0);
  const latest = useRef({ pitch, turns, view });
  latest.current = { pitch, turns, view };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const scrubFrame = () => {
    frame.current = 0;
    const { pitch, turns, view: thread } = latest.current;
    const box = rail.current?.getBoundingClientRect();
    const view = thread.scroll.current;
    if (!box || !view) return;
    const place = railPlace(
      pendingY.current - box.top - 8,
      pitch,
      turns.length,
    );
    scrollToRailPlace(view, turns, place, thread);
  };

  const end = () => {
    pressY.current = null;
    setScrubbing(false);
  };

  return {
    scrubbing,
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      // Held, the rail keeps the pointer when it drifts off the strip.
      e.currentTarget.setPointerCapture(e.pointerId);
      pressY.current = e.clientY;
      dragged.current = false;
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (pressY.current === null) return;
      const moved = Math.abs(e.clientY - pressY.current) >= DRAG_START;
      if (!dragged.current && !moved) return;
      dragged.current = true;
      setScrubbing(true);
      pendingY.current = e.clientY;
      frame.current ||= requestAnimationFrame(scrubFrame);
    },
    onPointerUp: end,
    onPointerCancel: end,
    /** A drag ends where it was let go, not on the tick a click would jump to. */
    onClickCapture(e: MouseEvent) {
      if (dragged.current) e.stopPropagation();
    },
  };
}
