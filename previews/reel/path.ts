import {
  add,
  clamp,
  cross,
  dot,
  len,
  lerp,
  mix3,
  norm,
  rotate,
  scale,
  sub,
  type Vec3,
} from "./math";

export interface Knot {
  p: Vec3;
  /** Ribbon width here, in world units. Carries on to later knots. */
  width?: number;
  /** Which way the ribbon's face looks. Carries on to later knots. */
  face?: Vec3;
  /** Extra twist around the direction of travel, in turns. Carries on. */
  roll?: number;
}

export interface Frame {
  p: Vec3;
  /** Direction of travel. */
  t: Vec3;
  /** The ribbon's face normal. */
  n: Vec3;
  /** Across the ribbon. */
  b: Vec3;
  width: number;
}

const SUBDIVISIONS = 28;

function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, k: number): Vec3 {
  const k2 = k * k;
  const k3 = k2 * k;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++)
    out[i] =
      0.5 *
      (2 * p1[i] +
        (p2[i] - p0[i]) * k +
        (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * k2 +
        (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * k3);
  return out;
}

const ease = (k: number) => k * k * (3 - 2 * k);

/**
 * A ribbon's centre line through its knots, sampled by distance travelled so
 * a ribbon can be drawn between any two distances along it.
 */
export class Path {
  readonly length: number;
  private readonly points: Vec3[] = [];
  private readonly tangents: Vec3[] = [];
  private readonly normals: Vec3[] = [];
  private readonly widths: number[] = [];
  private readonly distances: number[] = [];
  private readonly knotDistances: number[] = [];

  constructor(knots: Knot[]) {
    const filled: Required<Knot>[] = [];
    let width = 40;
    let face: Vec3 = [0, 0, 1];
    let roll = 0;
    for (const knot of knots) {
      width = knot.width ?? width;
      face = knot.face ?? face;
      roll = knot.roll ?? roll;
      filled.push({ p: knot.p, width, face, roll });
    }
    const last = filled.length - 1;
    const faces: Vec3[] = [];
    const rolls: number[] = [];
    for (let i = 0; i < last; i++) {
      const p0 = filled[Math.max(0, i - 1)].p;
      const p1 = filled[i].p;
      const p2 = filled[i + 1].p;
      const p3 = filled[Math.min(last, i + 2)].p;
      const steps = i === last - 1 ? SUBDIVISIONS + 1 : SUBDIVISIONS;
      for (let j = 0; j < steps; j++) {
        const k = j / SUBDIVISIONS;
        if (j === 0) this.knotDistances.push(this.points.length);
        this.points.push(catmull(p0, p1, p2, p3, k));
        const e = ease(k);
        this.widths.push(lerp(filled[i].width, filled[i + 1].width, e));
        faces.push(norm(mix3(filled[i].face, filled[i + 1].face, e)));
        rolls.push(lerp(filled[i].roll, filled[i + 1].roll, e));
      }
    }
    this.knotDistances.push(this.points.length - 1);

    const count = this.points.length;
    let travelled = 0;
    for (let i = 0; i < count; i++) {
      if (i > 0) travelled += len(sub(this.points[i], this.points[i - 1]));
      this.distances.push(travelled);
      const before = this.points[Math.max(0, i - 1)];
      const after = this.points[Math.min(count - 1, i + 1)];
      this.tangents.push(norm(sub(after, before)));
    }
    this.length = travelled;
    for (let i = 0; i < this.knotDistances.length; i++)
      this.knotDistances[i] = this.distances[this.knotDistances[i]];

    let previous: Vec3 = [0, 0, 1];
    for (let i = 0; i < count; i++) {
      const t = this.tangents[i];
      // The wanted face, flattened against the direction of travel. Heading
      // straight along it leaves nothing to flatten, so the last normal
      // carries through.
      let n = sub(faces[i], scale(t, dot(faces[i], t)));
      if (len(n) < 0.2) n = sub(previous, scale(t, dot(previous, t)));
      n = norm(n);
      previous = n;
      this.normals.push(rotate(n, t, rolls[i] * Math.PI * 2));
    }
  }

  /** Distance along the path at which knot `index` sits. */
  knot(index: number) {
    return this.knotDistances[index];
  }

  at(distance: number): Frame {
    const d = clamp(distance, 0, this.length);
    let lo = 0;
    let hi = this.distances.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.distances[mid] <= d) lo = mid;
      else hi = mid;
    }
    const gap = this.distances[hi] - this.distances[lo] || 1;
    const k = (d - this.distances[lo]) / gap;
    const t = norm(mix3(this.tangents[lo], this.tangents[hi], k));
    let n = mix3(this.normals[lo], this.normals[hi], k);
    n = norm(sub(n, scale(t, dot(n, t))));
    return {
      p: mix3(this.points[lo], this.points[hi], k),
      t,
      n,
      b: cross(t, n),
      width: lerp(this.widths[lo], this.widths[hi], k),
    };
  }

  /** Point `offset` across the ribbon (−1..1 is edge to edge) at `distance`. */
  across(distance: number, offset: number): Vec3 {
    const f = this.at(distance);
    return add(f.p, scale(f.b, (offset * f.width) / 2));
  }
}
