import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Check, Droplet, PenLine, Redo2, Trash2, Undo2 } from "lucide-react";
import type { DraftImage } from "../lib/draft-images";
import {
  blurredCopy,
  blurShape,
  blurSizes,
  distance,
  drawSketch,
  isLine,
  recognizeShape,
  scaleShape,
  shapeCenter,
  sketchColors,
  sketchSizes,
  snapLine,
  snapped,
  StrokeBuilder,
  type Point,
  type Shape,
  type Sketch,
  type SketchHistory,
  type Stroke,
} from "../lib/sketch";
import "./image-sketch.css";
import { mac } from "../lib/mod-key";

const PEN_KEY = "relay-sketch-pen";
interface Pen {
  tool: "pen" | "blur";
  color: string;
  size: number;
  blurSize: number;
}
function savedPen(): Pen {
  let saved: Partial<Pen> = {};
  try {
    saved = JSON.parse(localStorage.getItem(PEN_KEY) ?? "{}");
  } catch {
    // Falls back to the defaults below.
  }
  const { tool, color, size, blurSize } = saved;
  return {
    tool: tool === "blur" ? "blur" : "pen",
    color: sketchColors.includes(color!) ? color! : sketchColors[0],
    size: sketchSizes.includes(size!) ? size! : sketchSizes[1],
    blurSize: blurSizes.includes(blurSize!) ? blurSize! : blurSizes[1],
  };
}

type Pointer =
  | { kind: "drawing"; button: number }
  /** Stroke snapped to a clean shape; dragging further resizes it (or moves a line's end). */
  | { kind: "shaping"; button: number; anchor: Point; original: Shape };

const HOLD_MS = 500;
const HOLD_SLOP = 3;
const RIGHT_BUTTON = 2;
const mod = mac ? "⌘" : "Ctrl+";
const shift = mac ? "⇧" : "Shift+";

/**
 * A minimal drawing layer over a pasted screenshot. Strokes smooth into ink
 * (or blur, with the blur brush); pausing at the end of a stroke (or
 * right-dragging) snaps it into a clean line, circle or box.
 */
export function SketchEditor({
  image,
  history: initial,
  onClose,
}: {
  image: DraftImage;
  history: SketchHistory;
  onClose: (
    history: SketchHistory,
    size: Pick<Sketch, "width" | "height">,
  ) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState(initial);
  const [pen, setPen] = useState(savedPen);
  const [size, setSize] = useState(image.sketch);
  const blurring = pen.tool === "blur";
  const brush = blurring ? pen.blurSize : pen.size;
  const blurred = useRef<HTMLCanvasElement>(undefined);
  const pointer = useRef<Pointer>(undefined);
  const builder = useRef<StrokeBuilder>(undefined);
  const active = useRef<Stroke>(undefined);
  const hold = useRef({ point: { x: 0, y: 0 }, since: 0, timer: 0 });
  const frame = useRef(0);
  const strokes = useRef(history.present);
  strokes.current = history.present;

  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      clearInterval(hold.current.timer);
      cancelAnimationFrame(frame.current);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PEN_KEY, JSON.stringify(pen));
    } catch {
      // Still applies until the editor closes.
    }
  }, [pen]);

  function paint() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = canvas.current;
      const ctx = el?.getContext("2d");
      if (!el || !ctx || !size) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.setTransform(
        el.width / size.width,
        0,
        0,
        el.height / size.height,
        0,
        0,
      );
      const all = active.current
        ? [...strokes.current, active.current]
        : strokes.current;
      drawSketch(ctx, all, blurred.current, size);
    });
  }
  useEffect(paint, [history, size]);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || !size) return;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      el.width = Math.round(rect.width * devicePixelRatio);
      el.height = Math.round(rect.height * devicePixelRatio);
      paint();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [size]);

  function commit(next: (present: Stroke[]) => Stroke[]) {
    setHistory((h) => ({
      past: [...h.past, h.present],
      present: next(h.present),
      future: [],
    }));
  }
  function undo() {
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            present: h.past.at(-1)!,
            future: [h.present, ...h.future],
          }
        : h,
    );
  }
  function redo() {
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.present],
            present: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );
  }
  function close() {
    if (size) onClose(history, { width: size.width, height: size.height });
  }

  /** Image pixels per on-screen pixel, and the pointer in image pixels. */
  function locate(event: { clientX: number; clientY: number }) {
    const rect = canvas.current!.getBoundingClientRect();
    const unit = size!.width / rect.width;
    return {
      unit,
      point: {
        x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width) * unit,
        y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height) * unit,
      },
    };
  }

  function recognize(stroke: Stroke) {
    const shape = recognizeShape(stroke.points);
    return shape && stroke.blur ? blurShape(shape) : shape;
  }

  function checkHold() {
    const current = pointer.current;
    const stroke = builder.current?.stroke;
    if (current?.kind !== "drawing" || !stroke) return;
    if (performance.now() - hold.current.since < HOLD_MS) return;
    hold.current.since = Infinity; // one attempt per pause
    const shape = recognize(stroke);
    if (!shape) return;
    clearInterval(hold.current.timer);
    pointer.current = {
      kind: "shaping",
      button: current.button,
      anchor: hold.current.point,
      original: shape,
    };
    active.current = snapped(stroke, shape, builder.current!.baseWidth);
    paint();
  }

  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (
      pointer.current ||
      (event.button !== 0 && event.button !== RIGHT_BUTTON)
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { unit, point } = locate(event);
    pointer.current = { kind: "drawing", button: event.button };
    builder.current = new StrokeBuilder(
      point,
      event.timeStamp,
      pen.color,
      brush * unit,
      unit,
    );
    if (blurring) builder.current.stroke.blur = true;
    active.current = builder.current.stroke;
    hold.current = {
      point,
      since: event.timeStamp,
      timer: window.setInterval(checkHold, 50),
    };
    paint();
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (dot.current) {
      dot.current.style.translate = `${event.nativeEvent.offsetX}px ${event.nativeEvent.offsetY}px`;
      dot.current.hidden = false;
    }
    const current = pointer.current;
    const b = builder.current;
    if (!current || !b) return;
    const { unit, point } = locate(event);
    if (current.kind === "drawing") {
      if (distance(point, hold.current.point) > HOLD_SLOP * unit)
        hold.current = { ...hold.current, point, since: event.timeStamp };
      for (const sample of event.nativeEvent.getCoalescedEvents?.() ?? [event])
        b.add(locate(sample).point, sample.timeStamp);
      active.current = b.stroke;
    } else {
      const { anchor, original } = current;
      let shape: Shape;
      if (original.kind === "polyline" && isLine(original)) {
        shape = { ...original, points: snapLine(original.points[0], point) };
      } else {
        const c = shapeCenter(original);
        const scale = distance(point, c) / Math.max(distance(anchor, c), 1);
        shape = scaleShape(original, Math.max(scale, 0.05), c);
      }
      active.current = snapped(b.stroke, shape, b.baseWidth);
    }
    paint();
  }

  function up(event: PointerEvent<HTMLCanvasElement>) {
    const current = pointer.current;
    const b = builder.current;
    if (!current || !b) return;
    if (event.type !== "pointercancel" && event.button !== current.button)
      return;
    clearInterval(hold.current.timer);
    let stroke = current.kind === "drawing" ? b.finish() : active.current!;
    if (current.kind === "drawing" && current.button === RIGHT_BUTTON) {
      // Right-drag always snaps to a clean shape on release.
      const shape = recognize(stroke);
      if (shape) stroke = snapped(stroke, shape, b.baseWidth);
    }
    pointer.current = builder.current = active.current = undefined;
    commit((present) => [...present, stroke]);
  }

  return (
    <dialog
      ref={dialog}
      className="sketch-editor"
      aria-label={`Draw on ${image.name}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!pointer.current) close();
      }}
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey) || pointer.current) return;
        const key = event.key.toLowerCase();
        if (key === "z" || key === "y") {
          event.preventDefault();
          if (key === "y" || event.shiftKey) redo();
          else undo();
        }
      }}
    >
      <div className="sketch-stage">
        <img
          src={image.dataUrl}
          alt={image.name}
          draggable={false}
          onLoad={(event) => {
            // currentTarget is cleared once the handler returns, before the
            // updater runs, so read the dimensions now.
            const { naturalWidth: width, naturalHeight: height } =
              event.currentTarget;
            setSize((current) => current ?? { width, height, strokes: [] });
            blurred.current = blurredCopy(event.currentTarget, width, height);
            paint();
          }}
        />
        {size && (
          <canvas
            ref={canvas}
            aria-label="Drawing layer"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={() => dot.current && (dot.current.hidden = true)}
            onContextMenu={(event) => event.preventDefault()}
          />
        )}
        <div
          ref={dot}
          className="sketch-cursor"
          data-blur={blurring || undefined}
          hidden
          style={{
            background: blurring ? undefined : pen.color,
            width: Math.max(brush, 4),
            height: Math.max(brush, 4),
          }}
        />
      </div>
      <div className="sketch-palette">
        <div className="sketch-tools">
          <button
            type="button"
            aria-label="Pen"
            title="Pen"
            aria-pressed={!blurring}
            className="sketch-tool"
            onClick={() => setPen((p) => ({ ...p, tool: "pen" }))}
          >
            <PenLine size={16} />
          </button>
          <button
            type="button"
            aria-label="Blur"
            title="Blur · pause on a box to blur all of it"
            aria-pressed={blurring}
            className="sketch-tool"
            onClick={() => setPen((p) => ({ ...p, tool: "blur" }))}
          >
            <Droplet size={16} />
          </button>
          <span className="sketch-separator" />
          {sketchColors.map((color) => (
            <button
              key={color}
              type="button"
              className="sketch-color"
              aria-label={`Color ${color}`}
              aria-pressed={!blurring && pen.color === color}
              style={{ color }}
              onClick={() => setPen((p) => ({ ...p, tool: "pen", color }))}
            />
          ))}
          <span className="sketch-separator" />
          {(blurring ? blurSizes : sketchSizes).map((width, i) => (
            <button
              key={i}
              type="button"
              className="sketch-size"
              aria-label={["Thin", "Medium", "Thick"][i]}
              aria-pressed={brush === width}
              onClick={() =>
                setPen((p) =>
                  blurring ? { ...p, blurSize: width } : { ...p, size: width },
                )
              }
            >
              <span style={{ width: [5, 8, 13][i], height: [5, 8, 13][i] }} />
            </button>
          ))}
          <span className="sketch-separator" />
          <button
            type="button"
            aria-label="Undo"
            title={`Undo (${mod}Z)`}
            disabled={!history.past.length}
            onClick={undo}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title={`Redo (${mod}${shift}Z)`}
            disabled={!history.future.length}
            onClick={redo}
          >
            <Redo2 size={16} />
          </button>
          <button
            type="button"
            aria-label="Clear drawing"
            disabled={!history.present.length}
            onClick={() => commit(() => [])}
          >
            <Trash2 size={16} />
          </button>
          <span className="sketch-separator" />
          <button type="button" aria-label="Done" onClick={close}>
            <Check size={17} />
          </button>
        </div>
        <p>
          Pause to snap a shape · Blur a box to hide all of it · {mod}Z undo ·
          Esc done · Burned in when sent
        </p>
      </div>
    </dialog>
  );
}

/** The drawing over a composer thumbnail, cropped like the image under it. */
export function SketchOverlay({
  sketch,
  src,
}: {
  sketch: Sketch;
  src: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let cancelled = false;
    const scale = Math.min(1, 320 / Math.max(sketch.width, sketch.height));
    const draw = (blurred?: HTMLCanvasElement) => {
      el.width = Math.max(1, Math.round(sketch.width * scale));
      el.height = Math.max(1, Math.round(sketch.height * scale));
      ctx.scale(scale, scale);
      drawSketch(ctx, sketch.strokes, blurred, sketch);
    };
    draw();
    if (sketch.strokes.some((s) => s.blur)) {
      const img = new Image();
      img.src = src;
      img
        .decode()
        .then(() => {
          if (!cancelled) draw(blurredCopy(img, sketch.width, sketch.height));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [sketch, src]);
  return <canvas ref={canvas} className="sketch-overlay" aria-hidden />;
}
