import { prepareScreenshot, type DraftImage } from "./draft-images";

/**
 * Ink drawn over a pasted screenshot. It stays a separate layer in the draft
 * and is only burned into the pixels when the message is sent. Coordinates are
 * image pixels, so the drawing survives any on-screen scaling.
 */
export interface Point {
  x: number;
  y: number;
}
export type Shape =
  | { kind: "polyline"; points: Point[]; closed: boolean }
  | { kind: "ellipse"; center: Point; rx: number; ry: number; angle: number };
export interface Stroke {
  color: string;
  points: Point[];
  widths: number[];
  /** Set once the stroke snapped to a clean shape; drawn with an even width instead of the ink. */
  shape?: Shape;
  shapeWidth?: number;
  /** Blurs the screenshot under the stroke instead of inking it; a closed shape blurs its whole inside. */
  blur?: boolean;
}
export interface Sketch {
  width: number;
  height: number;
  strokes: Stroke[];
}

export const sketchColors = [
  "#ff3b30",
  "#ff9500",
  "#ffd100",
  "#34c759",
  "#007aff",
  "#b052de",
  "#1a1a1a",
  "#ffffff",
];
/** Pen widths in on-screen pixels. */
export const sketchSizes = [3, 5, 9];
/** Blur brush widths in on-screen pixels. */
export const blurSizes = [16, 30, 52];

export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export function snapped(stroke: Stroke, shape: Shape, width: number): Stroke {
  return { ...stroke, shape, shapeWidth: width };
}

/**
 * Turns raw pointer samples into a smooth, pen-like stroke: input is
 * streamlined with an exponential moving average, width varies slightly with
 * speed and the tail tapers out. `unit` is image pixels per screen pixel.
 */
export class StrokeBuilder {
  readonly stroke: Stroke;
  private smoothed: Point;
  private lastRaw: Point;
  private lastTime: number;
  private width: number;

  private static readonly streamline = 0.58;
  private static readonly minDistance = 0.75;

  constructor(
    start: Point,
    time: number,
    color: string,
    readonly baseWidth: number,
    private readonly unit: number,
  ) {
    this.smoothed = start;
    this.lastRaw = start;
    this.lastTime = time;
    this.width = baseWidth * 0.6;
    this.stroke = { color, points: [start], widths: [this.width] };
  }

  add(p: Point, time: number) {
    const dt = Math.max(time - this.lastTime, 1) / 1000;
    const speed = distance(p, this.lastRaw) / this.unit / dt;
    this.lastRaw = p;
    this.lastTime = time;
    const k = 1 - StrokeBuilder.streamline;
    this.smoothed = {
      x: this.smoothed.x + (p.x - this.smoothed.x) * k,
      y: this.smoothed.y + (p.y - this.smoothed.y) * k,
    };
    const last = this.stroke.points.at(-1)!;
    if (distance(this.smoothed, last) < StrokeBuilder.minDistance * this.unit)
      return;
    const factor = Math.min(Math.max(1.12 - speed / 6000, 0.8), 1.12);
    this.width += (this.baseWidth * factor - this.width) * 0.12;
    this.stroke.points.push(this.smoothed);
    this.stroke.widths.push(this.width);
  }

  /** Catches the stroke up to where the pointer was released and tapers the tail. */
  finish(): Stroke {
    const { points, widths } = this.stroke;
    if (points.length === 1) {
      widths[0] = this.baseWidth;
      return this.stroke;
    }
    // The moving average lags behind the pointer; close the gap so the line ends where you let go.
    for (
      let i = 0;
      i < 12 && distance(this.lastRaw, points.at(-1)!) > 1.5 * this.unit;
      i++
    ) {
      this.smoothed = {
        x: (this.smoothed.x + this.lastRaw.x) / 2,
        y: (this.smoothed.y + this.lastRaw.y) / 2,
      };
      points.push(this.smoothed);
      widths.push(this.width);
    }
    const n = widths.length;
    const taper = Math.min(n - 1, 6);
    for (let k = 0; k < taper; k++)
      widths[n - 1 - k] *= 0.55 + (0.45 * k) / taper;
    return this.stroke;
  }
}

function shapePath(shape: Shape): Path2D {
  const path = new Path2D();
  if (shape.kind === "ellipse") {
    const { center, rx, ry, angle } = shape;
    path.ellipse(center.x, center.y, rx, ry, angle, 0, Math.PI * 2);
    return path;
  }
  shape.points.forEach((p, i) =>
    i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y),
  );
  if (shape.closed) path.closePath();
  return path;
}

/**
 * Draws a stroke as a chain of quadratic curves through the midpoints of the
 * samples. Each segment gets its own width and round caps, so width changes
 * blend seamlessly and sharp turns never spike.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const { points: p, widths: w } = s;
  if (!p.length) return;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.shape) {
    ctx.lineWidth = s.shapeWidth ?? w[0];
    ctx.stroke(shapePath(s.shape));
  } else if (p.length === 1) {
    ctx.beginPath();
    ctx.arc(p[0].x, p[0].y, w[0] / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    let from = p[0];
    for (let i = 1; i < p.length - 1; i++) {
      const mid = {
        x: (p[i].x + p[i + 1].x) / 2,
        y: (p[i].y + p[i + 1].y) / 2,
      };
      ctx.lineWidth = w[i];
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(p[i].x, p[i].y, mid.x, mid.y);
      ctx.stroke();
      from = mid;
    }
    ctx.lineWidth = w[p.length - 1];
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A strongly blurred copy of the screenshot at image size. The radius scales
 * with the image so text stays unreadable on retina captures too.
 */
export function blurredCopy(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  // The unblurred pass keeps the edges opaque where the blur fades out.
  ctx.drawImage(source, 0, 0, width, height);
  ctx.filter = `blur(${Math.max(8, Math.round(Math.max(width, height) / 110))}px)`;
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

let mask: HTMLCanvasElement | undefined;

/**
 * Draws the whole drawing in image coordinates (the context is already scaled
 * to them). Blur strokes go first through one shared mask, so ink always sits
 * on top of them whatever the order it was drawn in. Without `blurred` they are
 * skipped.
 */
export function drawSketch(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  blurred: CanvasImageSource | undefined,
  size: Pick<Sketch, "width" | "height">,
) {
  const blurs = strokes.filter((s) => s.blur);
  if (blurred && blurs.length) {
    mask ??= document.createElement("canvas");
    mask.width = ctx.canvas.width;
    mask.height = ctx.canvas.height;
    const m = mask.getContext("2d");
    if (m) {
      m.setTransform(ctx.getTransform());
      for (const stroke of blurs) {
        // An even band: the pen's speed swell and tapered tail would leave text peeking out.
        const width = Math.max(...stroke.widths);
        drawStroke(m, {
          ...stroke,
          color: "#000",
          widths: stroke.widths.map(() => width),
        });
        if (stroke.shape?.kind === "ellipse" || stroke.shape?.closed) {
          m.fillStyle = "#000";
          m.fill(shapePath(stroke.shape));
        }
      }
      m.globalCompositeOperation = "source-in";
      m.drawImage(blurred, 0, 0, size.width, size.height);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(mask, 0, 0);
      ctx.restore();
    }
  }
  strokes.forEach((stroke) => stroke.blur || drawStroke(ctx, stroke));
}

/** Burns the drawing into the screenshot; images without ink pass through. */
export async function flattenSketch(image: DraftImage): Promise<DraftImage> {
  const { sketch, ...plain } = image;
  if (!sketch?.strokes.length) return plain;
  const img = new Image();
  img.src = image.dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw on screenshot.");
  ctx.drawImage(img, 0, 0);
  ctx.scale(canvas.width / sketch.width, canvas.height / sketch.height);
  const blurred = sketch.strokes.some((s) => s.blur)
    ? blurredCopy(img, sketch.width, sketch.height)
    : undefined;
  drawSketch(ctx, sketch.strokes, blurred, sketch);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not draw on screenshot.");
  const prepared = await prepareScreenshot(
    new File([blob], image.name, { type: "image/png" }),
  );
  return { ...prepared, id: image.id, name: image.name };
}

/** Guesses which clean shape a freehand stroke was meant to be. */
export function recognizeShape(raw: Point[]): Shape | undefined {
  if (raw.length < 2) return;
  const pts = resample(raw, 96);
  const box = bounds(pts);
  const diag = Math.hypot(box.width, box.height);
  if (diag < 10) return;

  const length = pathLength(raw);
  const gap = distance(raw[0], raw[raw.length - 1]);
  const closed = gap < Math.max(diag * 0.22, 14) && length > diag * 1.6;

  if (!closed) {
    const simple = rdp(pts, Math.max(diag * 0.06, 5));
    if (simple.length <= 2)
      return {
        kind: "polyline",
        points: snapLine(pts[0], pts[pts.length - 1]),
        closed: false,
      };
    return { kind: "polyline", points: simple, closed: false };
  }

  const ellipse = fitEllipse(pts);
  const ellipseError = meanDistance(pts, ellipse);
  const poly = closedPolygon(pts, diag * 0.08);
  if (poly.length >= 3 && poly.length <= 4) {
    const polyShape: Shape = { kind: "polyline", points: poly, closed: true };
    if (meanDistance(pts, polyShape) < ellipseError)
      return regularizePolygon(poly);
  }
  if (ellipseError < diag * 0.05 || poly.length < 3)
    return regularizeEllipse(ellipse);
  return { kind: "polyline", points: poly, closed: true };
}

/** Snaps a line to horizontal / vertical / 45° when it's within a few degrees. */
export function snapLine(a: Point, b: Point): Point[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const step = Math.PI / 4;
  const snappedAngle = Math.round(angle / step) * step;
  if (Math.abs(angle - snappedAngle) >= (5 * Math.PI) / 180) return [a, b];
  const len = distance(a, b);
  return [
    a,
    {
      x: a.x + Math.cos(snappedAngle) * len,
      y: a.y + Math.sin(snappedAngle) * len,
    },
  ];
}

/** Blur covers text, so any closed shape becomes the upright box around it. */
export function blurShape(shape: Shape): Shape {
  if (shape.kind === "polyline" && !shape.closed) return shape;
  let box;
  if (shape.kind === "ellipse") {
    const { center: c, rx, ry, angle } = shape;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = Math.hypot(rx * cos, ry * sin);
    const hh = Math.hypot(rx * sin, ry * cos);
    box = { x: c.x - hw, y: c.y - hh, width: hw * 2, height: hh * 2 };
  } else {
    box = bounds(shape.points);
  }
  const { x, y, width, height } = box;
  return {
    kind: "polyline",
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
    closed: true,
  };
}

export function isLine(shape: Shape) {
  return (
    shape.kind === "polyline" && !shape.closed && shape.points.length === 2
  );
}

export function shapeCenter(shape: Shape): Point {
  if (shape.kind === "ellipse") return shape.center;
  const box = bounds(shape.points);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function scaleShape(shape: Shape, s: number, c: Point): Shape {
  const f = (p: Point) => ({
    x: c.x + (p.x - c.x) * s,
    y: c.y + (p.y - c.y) * s,
  });
  if (shape.kind === "polyline")
    return { ...shape, points: shape.points.map(f) };
  return {
    ...shape,
    center: f(shape.center),
    rx: shape.rx * s,
    ry: shape.ry * s,
  };
}

function fitEllipse(pts: Point[]): Shape {
  const n = pts.length;
  const cx = pts.reduce((sum, p) => sum + p.x, 0) / n;
  const cy = pts.reduce((sum, p) => sum + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // Extents along the principal axes match the drawn size better than std-dev.
  const ca = Math.cos(-angle);
  const sa = Math.sin(-angle);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const x = dx * ca - dy * sa;
    const y = dx * sa + dy * ca;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  return {
    kind: "ellipse",
    center: {
      x: cx + mx * Math.cos(angle) - my * Math.sin(angle),
      y: cy + mx * Math.sin(angle) + my * Math.cos(angle),
    },
    rx: (maxX - minX) / 2,
    ry: (maxY - minY) / 2,
    angle,
  };
}

function regularizeEllipse(shape: Shape): Shape {
  if (shape.kind !== "ellipse") return shape;
  let { rx, ry } = shape;
  if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.15) {
    const r = (rx + ry) / 2;
    return { ...shape, rx: r, ry: r, angle: 0 };
  }
  // Nearly level ovals become exactly level.
  const tolerance = (12 * Math.PI) / 180;
  let angle = shape.angle;
  let a = angle % Math.PI;
  if (a < 0) a += Math.PI;
  if (a < tolerance || a > Math.PI - tolerance) {
    angle = 0;
  } else if (Math.abs(a - Math.PI / 2) < tolerance) {
    angle = 0;
    [rx, ry] = [ry, rx];
  }
  return { ...shape, rx, ry, angle };
}

function regularizePolygon(poly: Point[]): Shape {
  const shape: Shape = { kind: "polyline", points: poly, closed: true };
  if (poly.length !== 4) return shape;
  const tolerance = (15 * Math.PI) / 180;
  const upright = poly.every((a, i) => {
    const b = poly[(i + 1) % 4];
    const angle = Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) % (Math.PI / 2);
    return angle < tolerance || angle > Math.PI / 2 - tolerance;
  });
  if (!upright) return shape;
  // Average the two left-most / right-most / top / bottom corners into straight sides.
  const xs = poly.map((p) => p.x).sort((a, b) => a - b);
  const ys = poly.map((p) => p.y).sort((a, b) => a - b);
  const left = (xs[0] + xs[1]) / 2;
  const right = (xs[2] + xs[3]) / 2;
  const top = (ys[0] + ys[1]) / 2;
  const bottom = (ys[2] + ys[3]) / 2;
  return {
    kind: "polyline",
    points: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
    closed: true,
  };
}

/**
 * Corners of a closed stroke. The stroke may start mid-edge, so after the
 * usual simplification any vertex lying on a straight edge is dropped.
 */
function closedPolygon(pts: Point[], epsilon: number): Point[] {
  let far = 0;
  pts.forEach((p, i) => {
    if (distance(pts[0], p) > distance(pts[0], pts[far])) far = i;
  });
  if (far === 0) return [pts[0]];
  const poly = [
    ...rdp(pts.slice(0, far + 1), epsilon).slice(0, -1),
    ...rdp([...pts.slice(far), pts[0]], epsilon).slice(0, -1),
  ];
  let changed = true;
  while (changed && poly.length > 3) {
    changed = false;
    for (let i = 0; i < poly.length; i++) {
      const prev = poly[(i + poly.length - 1) % poly.length];
      const next = poly[(i + 1) % poly.length];
      if (
        segmentDistance(poly[i], prev, next) < epsilon ||
        distance(poly[i], next) < epsilon
      ) {
        poly.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return poly;
}

function rdp(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  let maxD = 0;
  let index = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segmentDistance(pts[i], a, b);
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD <= epsilon) return [a, b];
  return [
    ...rdp(pts.slice(0, index + 1), epsilon).slice(0, -1),
    ...rdp(pts.slice(index), epsilon),
  ];
}

function meanDistance(pts: Point[], shape: Shape): number {
  let total = 0;
  if (shape.kind === "polyline") {
    const poly = shape.points;
    const edges = shape.closed ? poly.length : poly.length - 1;
    for (const p of pts) {
      let best = edges > 0 ? Infinity : 0;
      for (let e = 0; e < edges; e++)
        best = Math.min(
          best,
          segmentDistance(p, poly[e], poly[(e + 1) % poly.length]),
        );
      total += best;
    }
  } else {
    const { center: c, rx, ry, angle } = shape;
    const ca = Math.cos(-angle);
    const sa = Math.sin(-angle);
    for (const p of pts) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const x = dx * ca - dy * sa;
      const y = dx * sa + dy * ca;
      const r = Math.hypot(x / Math.max(rx, 1), y / Math.max(ry, 1));
      total +=
        r > 0 ? (Math.abs(r - 1) * Math.hypot(x, y)) / r : Math.min(rx, ry);
    }
  }
  return total / pts.length;
}

function resample(pts: Point[], count: number): Point[] {
  const total = pathLength(pts);
  if (total <= 0) return [pts[0]];
  const step = total / (count - 1);
  const out = [pts[0]];
  let carried = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = distance(a, b);
    while (carried + seg >= step && seg > 0) {
      const t = (step - carried) / seg;
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(a);
      seg = distance(a, b);
      carried = 0;
    }
    carried += seg;
  }
  if (out.length < count) out.push(pts[pts.length - 1]);
  return out;
}

function pathLength(pts: Point[]) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += distance(pts[i - 1], pts[i]);
  return total;
}

function bounds(pts: Point[]) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return distance(p, a);
  const t = Math.min(
    Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0),
    1,
  );
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
