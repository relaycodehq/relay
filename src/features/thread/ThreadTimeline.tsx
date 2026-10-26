import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";
import type { ChatMessage } from "../../../shared/projects";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { timelineTurns } from "./timeline";
import "./thread-timeline.css";

/** Pixels between ticks while they fit; past that they close up to fit the
 * view, and on a long thread run together into a bar the pointer reads. */
const PITCH = 9;
/** How many ticks either side of the pointer the lens widens. */
const LENS = 4;
/** The widest strip the rail answers the pointer in. */
const REACH = 40;
/** The most a tick widens, as a scale of its resting width. */
const WIDEST = 2.2;

/** The turn at the top of the view, or at the very bottom the last one. */
function turnInView(view: HTMLElement, turnOf: Map<string, number>) {
  const messages = view.querySelectorAll<HTMLElement>("[data-message-id]");
  const turn = (m: HTMLElement | undefined) =>
    (m && turnOf.get(m.dataset.messageId!)) ?? -1;
  if (view.scrollHeight - view.scrollTop - view.clientHeight < 2)
    return turn(messages[messages.length - 1]);
  const top = view.getBoundingClientRect().top + 48;
  for (const m of messages)
    if (m.getBoundingClientRect().bottom > top) return turn(m);
  return -1;
}

/** How wide tick `i` draws, as a scale of its resting width: the turn being
 * read is longest, and the ticks around the pointer widen toward it. */
function tickScale(i: number, pointer: number | null, active: number) {
  if (i === active) return WIDEST;
  if (pointer === null) return 1;
  const near = 1 - Math.abs(i - pointer) / LENS;
  return near > 0 ? 1 + near * (WIDEST - 1) : 1;
}

/**
 * Which turn the view shows, and the rail's room: where the view starts, how
 * tall it is above the composer, and how much room is left of the message
 * column.
 */
function useRailPlace(
  scroll: RefObject<HTMLDivElement | null>,
  turnOf: Map<string, number>,
  bottomInset: number,
) {
  const [active, setActive] = useState(-1);
  const [room, setRoom] = useState({ top: 0, height: 0, reach: 0 });
  useEffect(() => {
    const view = scroll.current;
    if (!view) return;
    const column = view.querySelector<HTMLElement>(".thread-message-column");
    let frame = 0;
    const update = () => {
      frame = 0;
      setActive(turnInView(view, turnOf));
      const top = view.offsetTop,
        height = view.clientHeight - bottomInset,
        // A narrow window has only the view's padding left of the text; the
        // rail keeps to that, or it would sit over the text and catch the
        // presses and drags meant to select it.
        reach = Math.min(REACH, column?.offsetLeft ?? REACH);
      setRoom((r) =>
        r.top === top && r.height === height && r.reach === reach
          ? r
          : { top, height, reach },
      );
    };
    const later = () => (frame ||= requestAnimationFrame(update));
    update();
    view.addEventListener("scroll", later, { passive: true });
    const observer = new ResizeObserver(later);
    observer.observe(view);
    if (column) observer.observe(column);
    return () => {
      view.removeEventListener("scroll", later);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scroll, turnOf, bottomInset]);
  return { active, room };
}

/**
 * A rail of one tick per prompt beside the thread: the turn being read is
 * lit, hovering one shows its prompt and how the answer starts, and clicking
 * jumps there, however far up it is.
 */
export function ThreadTimeline({
  listed,
  scroll,
  bottomInset,
  onJump,
}: {
  listed: ChatMessage[];
  /** The thread's scrolling view, which says which turn is being read. The
   * rail sits beside it, in the same positioned parent. */
  scroll: RefObject<HTMLDivElement | null>;
  /** The composer docked over the view's end; the rail centres above it. */
  bottomInset: number;
  onJump: (id: string) => void;
}) {
  const { turns, turnOf } = useMemo(() => timelineTurns(listed), [listed]);
  const { active, room } = useRailPlace(scroll, turnOf, bottomInset);
  const [pointer, setPointer] = useState<number | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const ids = useId();

  if (turns.length < 2) return null;
  const pitch = Math.max(
    0.5,
    Math.min(PITCH, (room.height - 48) / (turns.length - 1)),
  );
  const height = pitch * (turns.length - 1);
  const at = (clientY: number) => {
    const box = rail.current!.getBoundingClientRect();
    const i = Math.round((clientY - box.top - 8) / pitch);
    return Math.min(turns.length - 1, Math.max(0, i));
  };
  const onMove = (e: PointerEvent) => setPointer(at(e.clientY));
  const onKey = (e: KeyboardEvent) => {
    const from = pointer ?? Math.max(0, active);
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = e.key === "ArrowUp" ? -1 : 1;
      setPointer(Math.min(turns.length - 1, Math.max(0, from + step)));
    } else if (e.key === "Enter" && pointer !== null) {
      onJump(turns[pointer]!.id);
    } else if (e.key === "Escape") setPointer(null);
  };
  // The strip lies over the view but isn't inside it, so a wheel over it
  // would otherwise scroll nothing.
  const onWheel = (e: WheelEvent<HTMLElement>) => {
    const view = scroll.current;
    if (!view) return;
    const unit =
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.clientHeight : 1;
    view.scrollBy(e.deltaX * unit, e.deltaY * unit);
  };
  const turn = pointer === null ? undefined : turns[pointer];
  return (
    // The nav is the whole strip down the view's edge, so the rail shows as
    // soon as the pointer comes near it, not only once it finds a tick.
    <nav
      className="thread-timeline"
      aria-label="Prompts in this thread"
      onWheel={onWheel}
      style={
        {
          "--timeline-top": `${room.top}px`,
          "--timeline-room": `${room.height}px`,
          "--timeline-reach": `${room.reach}px`,
          "--tick-widest": WIDEST,
          "--timeline-height": `${height + 16}px`,
        } as CSSProperties
      }
    >
      <div className="thread-timeline-body">
        <div
          ref={rail}
          className="thread-timeline-rail"
          tabIndex={0}
          role="listbox"
          aria-activedescendant={
            pointer === null ? undefined : `${ids}-${pointer}`
          }
          onPointerMove={onMove}
          onPointerLeave={() => setPointer(null)}
          onBlur={() => setPointer(null)}
          onKeyDown={onKey}
          onClick={(e) => onJump(turns[at(e.clientY)]!.id)}
        >
          {turns.map((t, i) => (
            <i
              key={t.id}
              id={`${ids}-${i}`}
              role="option"
              aria-label={t.prompt}
              aria-selected={i === active}
              data-active={i === active || undefined}
              data-pointed={i === pointer || undefined}
              style={
                {
                  top: 8 + i * pitch,
                  "--tick-scale": tickScale(i, pointer, active),
                } as CSSProperties
              }
            />
          ))}
        </div>
        {turn && (
          <div
            className="thread-timeline-peek"
            style={{
              top: Math.min(height, Math.max(0, pointer! * pitch - 18)),
            }}
            aria-hidden
          >
            <strong>
              {turn.agent && <ProviderIcon provider={turn.agent} />}
              <span>{turn.prompt}</span>
            </strong>
            <p>
              {turn.answer || (turn.answering ? "Answering…" : "No answer")}
            </p>
          </div>
        )}
      </div>
    </nav>
  );
}
