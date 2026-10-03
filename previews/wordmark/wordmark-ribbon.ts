// A ribbon drawn along a centreline and shaded like the lavender R in
// assets/relay-mark.svg, so new letters can sit beside it.

/** [x, y, half-width, twist°]. The centreline passes through (x, y). At ±90°
 * the ribbon is edge-on, which is how folds and tapered ends are drawn. */
type RibbonPoint = readonly [number, number, number, number];

/** Between two points: the ribbon creases there and doubles back, tucking
 * the rest of itself behind, like the R where its bowl turns into the leg. */
export const FOLD = "fold";
export type RibbonStep = RibbonPoint | typeof FOLD;

export interface RibbonPiece {
  d: string;
  /** 0 (in shadow) … 1 (catching the light). */
  shade: number;
}

type Vec = number[];

const lerp = (a: Vec, b: Vec, u: number) => a.map((v, i) => v + (b[i] - v) * u);
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec) => v.map((c) => c / Math.hypot(...v));

// Light from the top left and towards the viewer, as the R's gradients fall.
const LIGHT = unit([-0.45, -0.6, 0.66]);
const HALFWAY = unit([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

function knot(a: Vec, b: Vec) {
  return Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), 1e-3) ** 0.5;
}

/** Centripetal Catmull-Rom through the points, so tight turns don't overshoot. */
function centreline(points: readonly RibbonPoint[], step: number): Vec[] {
  const all: Vec[] = [
    lerp([...points[1]], [...points[0]], 2),
    ...points.map((p) => [...p]),
    lerp([...points[points.length - 2]], [...points[points.length - 1]], 2),
  ];
  const out: Vec[] = [];
  for (let i = 1; i < all.length - 2; i++) {
    const [p0, p1, p2, p3] = all.slice(i - 1, i + 3);
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const n = Math.max(
      2,
      Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step),
    );
    for (let k = 0; k < n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const a1 = lerp(p0, p1, t / t1);
      const a2 = lerp(p1, p2, (t - t1) / (t2 - t1));
      const a3 = lerp(p2, p3, (t - t2) / (t3 - t2));
      const b1 = lerp(a1, a2, t / t2);
      const b2 = lerp(a2, a3, (t - t1) / (t3 - t1));
      out.push(lerp(b1, b2, (t - t1) / (t2 - t1)));
    }
  }
  out.push([...points[points.length - 1]]);
  return out;
}

function shade(tx: number, ty: number, twist: number) {
  const s = Math.sin(twist);
  const c = Math.cos(twist);
  // The surface turns about the direction of travel; both faces are lavender.
  const normal = c < 0 ? [-ty * s, tx * s, -c] : [ty * s, -tx * s, c];
  const diffuse = Math.max(0, dot(normal, LIGHT));
  const sheen = Math.max(0, dot(normal, HALFWAY)) ** 24;
  return Math.min(1, 0.1 + diffuse * 0.98 + sheen * 0.3);
}

const f = (n: number) => n.toFixed(1);

interface Rail {
  left: number[];
  right: number[];
  shade: number;
}

function rails(line: Vec[]): Rail[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / length;
    const ty = (b[1] - a[1]) / length;
    const twist = (p[3] * Math.PI) / 180;
    const half = Math.max(0, p[2]) * Math.cos(twist);
    return {
      left: [p[0] - ty * half, p[1] + tx * half],
      right: [p[0] + ty * half, p[1] - tx * half],
      shade: shade(tx, ty, twist),
    };
  });
}

function direction(from: Vec, to: Vec) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
}

/** Cuts the ribbon's end along the crease, which bisects the way in and out. */
function crease(rail: Rail, tip: Vec, along: number[], other: number[]) {
  let cx = along[0] + other[0];
  let cy = along[1] + other[1];
  if (Math.hypot(cx, cy) < 1e-3) [cx, cy] = [-along[1], along[0]];
  const cl = Math.hypot(cx, cy);
  cx /= cl;
  cy /= cl;
  const half = Math.hypot(rail.left[0] - tip[0], rail.left[1] - tip[1]);
  const across = cx * -along[1] + cy * along[0];
  const reach = Math.min(half * 2.5, half / Math.max(Math.abs(across), 1e-3));
  const sign = Math.sign(across) || 1;
  rail.left = [tip[0] + cx * reach * sign, tip[1] + cy * reach * sign];
  rail.right = [tip[0] - cx * reach * sign, tip[1] - cy * reach * sign];
}

/** Thin quads along the ribbon, each flat-shaded. Within a stretch they are
 * drawn in order, so a later part passes over an earlier one where the ribbon
 * crosses itself; after a fold the rest goes behind. */
export function ribbon(
  steps: readonly RibbonStep[],
  step = 1.6,
): RibbonPiece[] {
  const stretches: RibbonPoint[][] = [[]];
  for (const s of steps) {
    if (s === FOLD) stretches.push([stretches[stretches.length - 1].at(-1)!]);
    else stretches[stretches.length - 1].push(s);
  }
  const lines = stretches.map((points) => centreline(points, step));
  const railed = lines.map(rails);
  for (let k = 0; k < lines.length - 1; k++) {
    const a = lines[k];
    const b = lines[k + 1];
    const tip = a[a.length - 1];
    const wayIn = direction(a[a.length - 3], tip);
    const wayOut = direction(tip, b[2]);
    crease(railed[k][railed[k].length - 1], tip, wayIn, wayOut);
    crease(railed[k + 1][0], tip, wayOut, wayIn);
    // The underside shows for a little while after the crease.
    const next = railed[k + 1];
    for (let i = 0; i < next.length; i++)
      next[i].shade *= 1 - 0.45 * Math.max(0, 1 - i / 22);
  }
  const drawn: RibbonPiece[][] = railed.map((r) => {
    const pieces: RibbonPiece[] = [];
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i];
      const b = r[i + 1];
      pieces.push({
        d: `M${f(a.left[0])} ${f(a.left[1])}L${f(b.left[0])} ${f(b.left[1])}L${f(b.right[0])} ${f(b.right[1])}L${f(a.right[0])} ${f(a.right[1])}Z`,
        shade: (a.shade + b.shade) / 2,
      });
    }
    return pieces;
  });
  return drawn.reverse().flat();
}

export function bounds(pieces: RibbonPiece[]) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const piece of pieces) {
    const n = piece.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (let i = 0; i < n.length; i += 2) {
      box.x0 = Math.min(box.x0, n[i]);
      box.x1 = Math.max(box.x1, n[i]);
      box.y0 = Math.min(box.y0, n[i + 1]);
      box.y1 = Math.max(box.y1, n[i + 1]);
    }
  }
  return box;
}
