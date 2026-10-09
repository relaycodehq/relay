import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import {
  clamp01,
  curve,
  handles,
  type CurvePoint,
  type Handle,
} from "../website/reel";

export interface LaneBox {
  /** Left edge and width of the plot, in svg pixels. */
  left: number;
  width: number;
  top: number;
  height: number;
}

/** Where on the lane, 0 to 1 both ways, a pointer is; `loose` lets it past the edges. */
function pointerAt(
  event: PointerEvent | MouseEvent,
  box: LaneBox,
  loose = false,
) {
  const rect = (
    event.currentTarget as SVGGraphicsElement
  ).ownerSVGElement!.getBoundingClientRect();
  const t = (event.clientX - rect.left - box.left) / box.width;
  const v = 1 - (event.clientY - rect.top - box.top) / box.height;
  return loose ? { t, v } : { t: clamp01(t), v: clamp01(v) };
}

type Part = "point" | "in" | "out";

/**
 * A curve you shape by hand, like After Effects' graph editor: drag a
 * keyframe or its handles (Alt moves one handle on its own), double-click
 * the lane to add a keyframe, a keyframe to drop it, a handle to make it
 * smooth again. The end keyframes stay at the start and the end. A press on
 * the lane itself scrubs to that moment.
 */
export function CurveLane({
  box,
  points,
  onChange,
  onScrub,
  label,
  axis,
  guide,
}: {
  box: LaneBox;
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  onScrub: (t: number) => void;
  label: string;
  /** Text for the right-hand axis at a value from 0 to 1. */
  axis: (v: number) => string;
  /** A dashed line across the lane, with its label. */
  guide?: { v: number; label: string };
}) {
  const [dragging, setDragging] = useState<{
    index: number;
    part: Part;
  } | null>(null);
  const scrubbing = useRef(false);
  const { left, width, top, height } = box;
  const x = (t: number) => left + t * width;
  const y = (v: number) => top + (1 - v) * height;
  const at = curve(points);
  const reach = handles(points);
  const path = Array.from({ length: 241 }, (_, i) => {
    const t = i / 240;
    return `${i ? "L" : "M"}${x(t).toFixed(1)},${y(clamp01(at(t))).toFixed(1)}`;
  }).join("");

  const move = (event: PointerEvent, index: number) => {
    const { t, v } = pointerAt(event, box);
    const last = points.length - 1;
    const next = points.map((p) => ({ ...p }));
    next[index].v = v;
    if (index > 0 && index < last)
      next[index].t = Math.min(
        points[index + 1].t - 0.01,
        Math.max(points[index - 1].t + 0.01, t),
      );
    onChange(next);
  };
  const bend = (event: PointerEvent, index: number, part: "in" | "out") => {
    const p = points[index];
    const pointer = pointerAt(event, box, true);
    const room =
      part === "out" ? points[index + 1].t - p.t : p.t - points[index - 1].t;
    const dt =
      part === "out"
        ? Math.min(room, Math.max(0, pointer.t - p.t))
        : Math.max(-room, Math.min(0, pointer.t - p.t));
    const moved: Handle = { t: dt, v: pointer.v - p.v };
    const point: CurvePoint = { ...p, [part]: moved };
    const other = part === "out" ? "in" : "out";
    const ends = index === 0 || index === points.length - 1;
    if (!ends) point[other] = reach[index][other];
    // Keep the keyframe smooth: the other handle turns to match, keeping its length on screen.
    if (!event.altKey && !ends) {
      const length = Math.hypot(
        point[other]!.t * width,
        point[other]!.v * height,
      );
      const angle = Math.atan2(moved.v * height, moved.t * width);
      point[other] = {
        t: (-Math.cos(angle) * length) / width,
        v: (-Math.sin(angle) * length) / height,
      };
    }
    onChange(points.map((q, j) => (j === index ? point : q)));
  };
  const shown =
    dragging && dragging.part === "point" ? points[dragging.index] : null;

  return (
    <g className="lane">
      <rect
        className="lane-bed"
        x={left}
        y={top}
        width={width}
        height={height}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubbing.current = true;
          onScrub(pointerAt(event, box).t);
        }}
        onPointerMove={(event) => {
          if (scrubbing.current) onScrub(pointerAt(event, box).t);
        }}
        onPointerUp={() => (scrubbing.current = false)}
        onDoubleClick={(event) => {
          const point = pointerAt(event, box);
          if (point.t <= 0 || point.t >= 1) return;
          onChange([...points, point].sort((a, b) => a.t - b.t));
        }}
      />
      {[0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v} className="lane-grid">
          <line x1={left} x2={left + width} y1={y(v)} y2={y(v)} />
          <text x={left + width + 6} y={y(v) + 3.5}>
            {axis(v)}
          </text>
        </g>
      ))}
      {guide && guide.v > 0 && guide.v <= 1 && (
        <g className="lane-guide">
          <line x1={left} x2={left + width} y1={y(guide.v)} y2={y(guide.v)} />
          <text x={left + 6} y={y(guide.v) - 5}>
            {guide.label}
          </text>
        </g>
      )}
      <text className="lane-label" x={left - 12} y={top + 14}>
        {label}
      </text>
      <path className="lane-curve" d={path} />
      {points.map((p, i) =>
        (["in", "out"] as const)
          .filter((part) => (part === "in" ? i > 0 : i < points.length - 1))
          .map((part) => {
            const handle = reach[i][part];
            const hx = x(p.t + handle.t);
            const hy = y(p.v + handle.v);
            const active = dragging?.index === i && dragging.part === part;
            return (
              <g key={`${i}${part}`} className="lane-handle">
                <line x1={x(p.t)} y1={y(p.v)} x2={hx} y2={hy} />
                <rect
                  x={hx - 4}
                  y={hy - 4}
                  width={8}
                  height={8}
                  data-auto={!p[part] || undefined}
                  data-active={active || undefined}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragging({ index: i, part });
                  }}
                  onPointerMove={(event) => {
                    if (active) bend(event, i, part);
                  }}
                  onPointerUp={() => setDragging(null)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onChange(
                      points.map((q, j) => (j === i ? { t: q.t, v: q.v } : q)),
                    );
                  }}
                />
              </g>
            );
          }),
      )}
      {points.map((p, i) => (
        <circle
          key={i}
          className="lane-point"
          data-end={i === 0 || i === points.length - 1 || undefined}
          data-active={
            (dragging?.index === i && dragging.part === "point") || undefined
          }
          cx={x(p.t)}
          cy={y(p.v)}
          r={6}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging({ index: i, part: "point" });
          }}
          onPointerMove={(event) => {
            if (dragging?.index === i && dragging.part === "point")
              move(event, i);
          }}
          onPointerUp={() => setDragging(null)}
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (i === 0 || i === points.length - 1) return;
            onChange(points.filter((_, j) => j !== i));
          }}
        />
      ))}
      {shown && (
        <text
          className="lane-readout"
          x={x(shown.t)}
          y={y(shown.v) - 12}
          textAnchor="middle"
        >
          {axis(shown.v)}
        </text>
      )}
    </g>
  );
}
