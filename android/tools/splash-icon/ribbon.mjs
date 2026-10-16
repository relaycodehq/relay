// The splash ribbon's geometry, the same as app/splash/RibbonGuide.kt and PullSplash.kt. It runs in
// Node (for the parity samples the Kotlin test checks) and in the page render.mjs draws the still in.

const PER_SEGMENT = 48;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const catmull = (a0, a1, a2, a3, x) =>
  0.5 * (2 * a1 + (-a0 + a2) * x + (2 * a0 - 5 * a1 + 4 * a2 - a3) * x * x + (-a0 + 3 * a1 - 3 * a2 + a3) * x * x * x);

export class Guide {
  constructor(knots, alignKnot) {
    this.pos = []; this.tan = []; this.bin = []; this.twist = []; this.width = []; this.boost = []; this.arc = []; this.knotArc = [];
    const n = knots.length;
    const P = knots.map((k) => k.p);
    const pt = (i) => (i < 0 ? sub(mul(P[0], 2), P[1]) : i >= n ? sub(mul(P[n - 1], 2), P[n - 2]) : P[i]);
    const sc = (v, i) => (i < 0 ? 2 * v[0] - v[1] : i >= n ? 2 * v[n - 1] - v[n - 2] : v[i]);
    const W = knots.map((k) => k.w), TW = knots.map((k) => k.twist), BO = knots.map((k) => k.boost ?? 1);
    const knotSample = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = pt(i - 1), p1 = P[i], p2 = P[i + 1], p3 = pt(i + 2);
      const t0 = 0;
      const t1 = t0 + Math.max(Math.sqrt(len(sub(p1, p0))), 1e-4);
      const t2 = t1 + Math.max(Math.sqrt(len(sub(p2, p1))), 1e-4);
      const t3 = t2 + Math.max(Math.sqrt(len(sub(p3, p2))), 1e-4);
      knotSample[i] = this.pos.length;
      const last = i === n - 2 ? PER_SEGMENT : PER_SEGMENT - 1;
      for (let j = 0; j <= last; j++) {
        const x = j / PER_SEGMENT;
        const t = t1 + (t2 - t1) * x;
        const a1 = add(mul(p0, (t1 - t) / (t1 - t0)), mul(p1, (t - t0) / (t1 - t0)));
        const a2 = add(mul(p1, (t2 - t) / (t2 - t1)), mul(p2, (t - t1) / (t2 - t1)));
        const a3 = add(mul(p2, (t3 - t) / (t3 - t2)), mul(p3, (t - t2) / (t3 - t2)));
        const b1 = add(mul(a1, (t2 - t) / (t2 - t0)), mul(a2, (t - t0) / (t2 - t0)));
        const b2 = add(mul(a2, (t3 - t) / (t3 - t1)), mul(a3, (t - t1) / (t3 - t1)));
        this.pos.push(add(mul(b1, (t2 - t) / (t2 - t1)), mul(b2, (t - t1) / (t2 - t1))));
        this.width.push(catmull(sc(W, i - 1), W[i], W[i + 1], sc(W, i + 2), x));
        this.twist.push(catmull(sc(TW, i - 1), TW[i], TW[i + 1], sc(TW, i + 2), x));
        this.boost.push(catmull(sc(BO, i - 1), BO[i], BO[i + 1], sc(BO, i + 2), x));
      }
    }
    knotSample[n - 1] = this.pos.length - 1;
    const m = this.pos.length;
    let acc = 0;
    for (let i = 0; i < m; i++) {
      if (i > 0) acc += len(sub(this.pos[i], this.pos[i - 1]));
      this.arc.push(acc);
      this.tan.push(norm(sub(this.pos[Math.min(m - 1, i + 1)], this.pos[Math.max(0, i - 1)])));
    }
    this.length = acc;
    for (const k of knotSample) this.knotArc.push(this.arc[k]);
    const t0 = this.tan[0];
    this.bin.push(norm(cross(Math.abs(t0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], t0)));
    for (let i = 0; i < m - 1; i++) {
      const v1 = sub(this.pos[i + 1], this.pos[i]);
      const c1 = dot(v1, v1);
      const r = this.bin[i];
      if (c1 < 1e-12) { this.bin.push(r); continue; }
      const rL = sub(r, mul(v1, (2 / c1) * dot(v1, r)));
      const tL = sub(this.tan[i], mul(v1, (2 / c1) * dot(v1, this.tan[i])));
      const v2 = sub(this.tan[i + 1], tL);
      const c2 = dot(v2, v2);
      this.bin.push(norm(c2 < 1e-12 ? rL : sub(rL, mul(v2, (2 / c2) * dot(v2, rL)))));
    }
    const ref = knotSample[alignKnot];
    const T = this.tan[ref];
    const flat = norm(cross([0, 0, 1], T));
    const B = this.bin[ref];
    const phi = Math.atan2(dot(cross(B, flat), T), dot(B, flat));
    const c = Math.cos(phi), s = Math.sin(phi);
    for (let i = 0; i < m; i++) this.bin[i] = norm(add(mul(this.bin[i], c), mul(cross(this.tan[i], this.bin[i]), s)));
  }

  sample(u) {
    const m = this.pos.length;
    if (u <= 0) return this.at(0, 0, u);
    if (u >= this.length) return this.at(m - 1, 0, u - this.length);
    let lo = 0, hi = m - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.arc[mid] <= u) lo = mid; else hi = mid;
    }
    return this.at(lo, (u - this.arc[lo]) / (this.arc[hi] - this.arc[lo] || 1), 0);
  }

  at(i, f, beyond) {
    const j = Math.min(i + 1, this.pos.length - 1);
    const t = norm(lerp3(this.tan[i], this.tan[j], f));
    let b = lerp3(this.bin[i], this.bin[j], f);
    b = norm(sub(b, mul(t, dot(b, t))));
    return {
      p: add(lerp3(this.pos[i], this.pos[j], f), mul(t, beyond)),
      t,
      b,
      twist: this.twist[i] + (this.twist[j] - this.twist[i]) * f,
      width: this.width[i] + (this.width[j] - this.width[i]) * f,
      boost: this.boost[i] + (this.boost[j] - this.boost[i]) * f,
    };
  }
}

// x, y, width, half turns, depth, in assets/relay-mark.svg's inner coordinates.
const R_MARK = [
  [115, 64, 1, 0, 0], [160, 116, 8, 0, 0], [198, 175, 13, 0, 0], [226, 239, 20, 0, 0], [245, 305, 26, 0, 0],
  [254, 375, 29, 0, 0], [246, 410, 26, 0.25, 0], [229, 431, 22, 0.5, 0], [210, 414, 26, 0.75, 0], [186, 388, 30, 1, 0],
  [163, 355, 33, 1, 0], [145, 320, 33, 1, 0], [134, 285, 31, 1, 0], [132, 256, 29, 1, 0], [143, 234, 29, 1, 2],
  [165, 224, 29, 1, 4], [205, 224, 31, 1, 4], [245, 229, 31, 1, 4], [285, 240, 30, 1, 2], [322, 251, 30, 1, 0],
  [360, 265, 29, 1, 0], [390, 279, 27, 1.2, 0], [405, 291, 24, 1.5, 0], [388, 302, 24, 1.8, 0], [352, 296, 25, 2, 0],
  [322, 298, 28, 2, 0], [300, 314, 30, 2, 0], [316, 336, 27, 2, 0], [340, 355, 26, 2, 0], [386, 387, 25, 2, 0],
  [430, 416, 23, 2, 0], [460, 437, 20, 2, 0], [480, 456, 17, 2, 0], [493, 476, 12, 2, 0], [497, 494, 3, 2, 0],
];
export const R_KNOTS = R_MARK.map(([x, y, w, tw, z]) => ({
  p: [(x - 310) / 100, -(y - 285) / 100, z / 100],
  w: (w * 1.12) / 100,
  twist: tw * Math.PI,
}));
const knot = (p, halfTurns, boost = 1) => ({ p, w: 0.27, twist: halfTurns * Math.PI, boost });
const EXIT = [
  knot([2.0, -2.95, 0.3], 2), knot([2.6, -4.3, 1.4], 2.4, 1.1), knot([4.3, -4.6, 4.5], 3.2, 1.4),
  knot([4.4, -0.8, 9], 4.2, 1.8), knot([0.6, 3.6, 14], 5.2, 2.2), knot([-3.4, 1.6, 20], 6.2, 2.5),
  knot([-2.4, -2.4, 27], 7, 2.6), knot([0.4, -1.2, 34], 7.8, 2.6), knot([0.15, 0.1, 40.4], 8.3, 2.6),
  knot([-0.5, 0.9, 48], 8.8, 2.6), knot([-1.6, 1.8, 62], 9.4, 2.6), knot([-2.5, 2.4, 76], 10, 2.6),
];

export const rGuide = new Guide(R_KNOTS, 4);
export const pullGuide = new Guide([...R_KNOTS, ...EXIT], 4);
export const span = pullGuide.knotArc[R_KNOTS.length - 1];

export const CAMERA_DISTANCE = 40;
export const ICON_PX = 1152;
export const UNIT_PX = 118;
export const SAMPLES = 1800;

/** The strip the overlay draws on its first frames: the ribbon at rest on the R. */
export function restStrip() {
  const out = new Float32Array(SAMPLES * 2 * 13);
  let o = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const s = i / (SAMPLES - 1);
    const g = pullGuide.sample(s * span);
    const w = rGuide.sample(s * rGuide.length).width * g.boost;
    const n0 = cross(g.t, g.b);
    const c = Math.cos(g.twist), sn = Math.sin(g.twist);
    const W = [g.b[0] * c + n0[0] * sn, g.b[1] * c + n0[1] * sn, g.b[2] * c + n0[2] * sn];
    const N = cross(g.t, W);
    for (const side of [0, 1]) {
      const k = (side - 0.5) * w;
      out.set([g.p[0] + W[0] * k, g.p[1] + W[1] * k, g.p[2] + W[2] * k, ...N, ...g.t, s, side, 0, w], o);
      o += 13;
    }
  }
  return out;
}

/** The camera SplashRenderer.viewProjection builds, for an icon filling a square canvas. */
export function iconViewProjection() {
  const d = CAMERA_DISTANCE, f = (2 * d * UNIT_PX) / ICON_PX;
  const near = 0.01, far = 500;
  const a = (far + near) / (near - far), b = (2 * far * near) / (near - far);
  return new Float32Array([f, 0, 0, 0, 0, f, 0, 0, 0, 0, a, -1, 0, 0, a * -d + b, d]);
}
