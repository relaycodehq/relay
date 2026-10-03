import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Check } from "lucide-react";
import {
  formatDuration,
  type ClockifyBlock,
  type ClockifyReview,
} from "../../../shared/clockify";
import { clock } from "./clockify-format";

const MIN = 60_000;
/** The column fills about this height; a short day stretches to it. */
const TARGET_HEIGHT = 520;
const MIN_SCALE = 1.6;
const snap = (ms: number) => Math.round(ms / MIN) * MIN;

/**
 * The day as a calendar column: each entry sits at its time, sized by its
 * length. The edge between two entries drags up and down to move time from
 * one to the other; dragging it all the way drops the emptied entry.
 */
export function ClockifyDay({
  review,
  blocks,
  selected,
  colorOf,
  labelOf,
  onSelect,
  onEdit,
  onCommit,
}: {
  review: ClockifyReview;
  blocks: ClockifyBlock[];
  selected?: string;
  colorOf: (block: ClockifyBlock) => string;
  labelOf: (block: ClockifyBlock) => string;
  onSelect: (id: string) => void;
  onEdit: (id: string, edit: { start?: number; end?: number }) => void;
  onCommit: (ids: string[]) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number>();
  const minutes = (review.end - review.start) / MIN;
  const scale = Math.max(MIN_SCALE, TARGET_HEIGHT / minutes);
  const y = (t: number) => ((t - review.start) / MIN) * scale;

  const move = (i: number, t: number) => {
    const a = blocks[i],
      b = blocks[i + 1];
    const edge = Math.min(Math.max(snap(t), a.start), b.end);
    onEdit(a.id, { end: edge });
    onEdit(b.id, { start: edge });
  };
  const drag = (i: number) => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setDragging(i);
    const onMove = (ev: globalThis.PointerEvent) => {
      const top = track.current!.getBoundingClientRect().top;
      move(i, review.start + ((ev.clientY - top) / scale) * MIN);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      setDragging(undefined);
      onCommit([blocks[i].id, blocks[i + 1].id]);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };
  const nudge = (i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 5 : 1) * MIN;
    const delta =
      e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    move(i, blocks[i].end + delta);
  };

  const hours: number[] = [];
  const first = new Date(review.start);
  first.setMinutes(0, 0, 0);
  for (let t = first.getTime() + 60 * MIN; t < review.end; t += 60 * MIN)
    hours.push(t);
  const pauses = blocks.slice(1).flatMap((b, i) => {
    const prev = blocks[i];
    return b.start > prev.end ? [{ start: prev.end, end: b.start }] : [];
  });

  return (
    <div className="clockify-day" style={{ height: y(review.end) }}>
      <div className="clockify-day-hours" aria-hidden>
        <span data-edge="start" style={{ top: 0 }}>
          {clock(review.start)}
        </span>
        {hours
          .filter(
            (t) => t - review.start > 20 * MIN && review.end - t > 20 * MIN,
          )
          .map((t) => (
            <span key={t} style={{ top: y(t) }}>
              {clock(t)}
            </span>
          ))}
        <span data-edge="end" style={{ top: y(review.end) }}>
          {clock(review.end)}
        </span>
      </div>
      <div className="clockify-day-track" ref={track}>
        {hours.map((t) => (
          <i key={t} className="clockify-day-line" style={{ top: y(t) }} />
        ))}
        {pauses.map((p) => (
          <div
            key={p.start}
            className="clockify-day-pause"
            style={{ top: y(p.start), height: y(p.end) - y(p.start) }}
          >
            <span>Paused · {formatDuration(p.end - p.start)}</span>
          </div>
        ))}
        {blocks.map((b) => {
          const height = y(b.end) - y(b.start);
          if (height <= 0) return null;
          const empty = !b.clockifyProjectId;
          return (
            <button
              key={b.id}
              data-id={b.id}
              className="clockify-event"
              data-empty={empty || undefined}
              data-sent={b.submittedId ? true : undefined}
              data-size={height < 22 ? "xs" : height < 40 ? "s" : undefined}
              aria-pressed={selected === b.id}
              aria-label={`${labelOf(b)}, ${clock(b.start)} to ${clock(b.end)}`}
              title={`${labelOf(b)} · ${clock(b.start)}–${clock(b.end)}`}
              style={{
                top: y(b.start),
                height,
                ["--c" as string]: colorOf(b),
              }}
              onClick={() => onSelect(b.id)}
            >
              <span className="clockify-event-head">
                <b>{labelOf(b)}</b>
                <span>
                  {b.submittedId && (
                    <Check size={11} aria-label="In Clockify" />
                  )}
                  {formatDuration(b.end - b.start)}
                </span>
              </span>
              {!empty && (
                <span className="clockify-event-text">
                  {b.description ||
                    (review.describing ? "Drafting…" : "No description yet")}
                </span>
              )}
            </button>
          );
        })}
        {blocks.slice(0, -1).map((b, i) => {
          const next = blocks[i + 1];
          if (b.end !== next.start || b.submittedId || next.submittedId)
            return null;
          return (
            <div
              key={b.id}
              role="separator"
              aria-orientation="horizontal"
              aria-label={`Edge between ${labelOf(b)} and ${labelOf(next)}`}
              aria-valuetext={clock(b.end)}
              tabIndex={0}
              className="clockify-edge"
              data-dragging={dragging === i || undefined}
              style={{ top: y(b.end) }}
              onPointerDown={drag(i)}
              onKeyDown={nudge(i)}
              onKeyUp={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown")
                  onCommit([b.id, next.id]);
              }}
            >
              <span className="clockify-edge-time">{clock(b.end)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
