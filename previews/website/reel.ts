// The hero's agent reel as numbers: how fast it spins over time, how much it
// clicks into each name, and how long it rests. previews/hero-reel/ edits
// these on curves; paste what it copies into `defaultTiming`.

/** A handle's reach from its keyframe, in the curve's own units. */
export type Handle = { t: number; v: number };
/**
 * A keyframe. Like After Effects, each side has a bezier handle; one left out
 * is drawn smooth through the neighbours.
 */
export type CurvePoint = { t: number; v: number; in?: Handle; out?: Handle };

export interface ReelTiming {
  /** Seconds from leaving Claude to resting on "any ACP agent". */
  spin: number;
  /** Relative speed across the spin, `t` and `v` from 0 to 1. */
  speed: CurvePoint[];
  /** How hard the reel clicks into each name across the spin, 0 to 1. */
  clicks: CurvePoint[];
  /** Share of each click spent resting before the snap, 0 to 0.9. */
  pause: number;
  /** Vertical motion blur at top speed, in px. */
  blur: number;
  /** Names a second where the blur starts. */
  blurFrom: number;
  /** Milliseconds on Claude before a spin. */
  hold: number;
  /** Milliseconds on "any ACP agent" after it. */
  acpHold: number;
  /** Milliseconds rolling on from it to Claude. */
  land: number;
}

// Ticks through the first names, builds to about 7.5 names a second three
// quarters in, gliding by then, and brakes onto "any ACP agent". The long
// first handle is what makes the build feel exponential.
export const defaultTiming: ReelTiming = {
  spin: 5.95,
  speed: [
    { t: 0, v: 0.15, out: { t: 0.75, v: 0.11 } },
    { t: 0.75, v: 0.93, in: { t: -0.05, v: 0 }, out: { t: 0.16, v: 0 } },
    { t: 1, v: 0, in: { t: -0.03, v: 0.1 } },
  ],
  clicks: [
    { t: 0, v: 1, out: { t: 0.9, v: 0 } },
    { t: 1, v: 0.08, in: { t: -0.48, v: 0 } },
  ],
  pause: 0.45,
  blur: 3,
  blurFrom: 3,
  hold: 500,
  acpHold: 1000,
  land: 150,
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Each keyframe's two handles, the missing ones filled in smooth and without overshoot (Fritsch–Carlson). */
export function handles(points: CurvePoint[]): { in: Handle; out: Handle }[] {
  const n = points.length;
  const d = points
    .slice(1)
    .map((p, i) => (p.v - points[i].v) / (p.t - points[i].t || 1e-9));
  const m = points.map((_, i) =>
    i === 0
      ? (d[0] ?? 0)
      : i === n - 1
        ? d[n - 2]
        : d[i - 1] * d[i] <= 0
          ? 0
          : (d[i - 1] + d[i]) / 2,
  );
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      m[i] = (3 / Math.sqrt(s)) * a * d[i];
      m[i + 1] = (3 / Math.sqrt(s)) * b * d[i];
    }
  }
  return points.map((p, i) => {
    const before = i > 0 ? (p.t - points[i - 1].t) / 3 : 0;
    const after = i < n - 1 ? (points[i + 1].t - p.t) / 3 : 0;
    return {
      in: p.in ?? { t: -before, v: -before * m[i] },
      out: p.out ?? { t: after, v: after * m[i] },
    };
  });
}

/** The curve through the keyframes, read at `t`. */
export function curve(points: CurvePoint[]): (t: number) => number {
  const n = points.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => points[0].v;
  const reach = handles(points);
  return (t) => {
    if (t <= points[0].t) return points[0].v;
    if (t >= points[n - 1].t) return points[n - 1].v;
    let i = 0;
    while (t > points[i + 1].t) i++;
    const a = points[i];
    const b = points[i + 1];
    const span = b.t - a.t;
    // Handles stay inside their segment, so time only moves forward along it.
    const x1 = a.t + Math.min(span, Math.max(0, reach[i].out.t));
    const x2 = b.t + Math.max(-span, Math.min(0, reach[i + 1].in.t));
    const y1 = a.v + reach[i].out.v;
    const y2 = b.v + reach[i + 1].in.v;
    const bezier = (
      s: number,
      p0: number,
      p1: number,
      p2: number,
      p3: number,
    ) =>
      (1 - s) ** 3 * p0 +
      3 * (1 - s) ** 2 * s * p1 +
      3 * (1 - s) * s ** 2 * p2 +
      s ** 3 * p3;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 28; k++) {
      const mid = (lo + hi) / 2;
      if (bezier(mid, a.t, x1, x2, b.t) < t) lo = mid;
      else hi = mid;
    }
    return bezier((lo + hi) / 2, a.v, y1, y2, b.v);
  };
}

/** Rests on each name for `pause` of the way, then snaps on; `strength` blends that with plain motion. */
export function clicked(position: number, strength: number, pause: number) {
  const name = Math.floor(position);
  const x = position - name;
  const snap = x < pause ? 0 : 1 - (1 - (x - pause) / (1 - pause)) ** 3;
  return name + strength * snap + (1 - strength) * x;
}

export interface Spin {
  ms: number;
  /** Top speed in names a second. */
  peak: number;
  /** Names a second at 1 on the speed curve. */
  scale: number;
  /** Where the reel is, in names, and how fast it moves, `u` from 0 to 1. */
  at(u: number): { position: number; speed: number };
}

/** The spin over `names` names: the speed curve's area is scaled so it ends exactly on the last one. */
export function buildSpin(timing: ReelTiming, names: number): Spin {
  const speedAt = curve(timing.speed);
  const clickAt = curve(timing.clicks);
  const samples = 1000;
  const area = [0];
  let top = 0;
  for (let i = 1; i <= samples; i++) {
    const v = Math.max(0, speedAt((i - 0.5) / samples));
    top = Math.max(top, v);
    area.push(area[i - 1] + v / samples);
  }
  const toNames = names / (area[samples] || 1);
  const seconds = Math.max(0.1, timing.spin);
  return {
    ms: seconds * 1000,
    peak: (top * toNames) / seconds,
    scale: toNames / seconds,
    at(u) {
      const x = clamp01(u) * samples;
      const i = Math.min(samples - 1, Math.floor(x));
      const base = (area[i] + (area[i + 1] - area[i]) * (x - i)) * toNames;
      return {
        position: clicked(base, clamp01(clickAt(u)), timing.pause),
        speed: (Math.max(0, speedAt(u)) * toNames) / seconds,
      };
    },
  };
}

export type Phase = "hold" | "spin" | "acp" | "land";

export interface Frame {
  phase: Phase;
  position: number;
  speed: number;
  /** Milliseconds left in this phase. */
  left: number;
}

const easeInOut = (u: number) =>
  u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
const easeInOutSlope = (u: number) =>
  u < 0.5 ? 12 * u ** 2 : 3 * (-2 * u + 2) ** 2;

export interface Cycle {
  ms: number;
  spin: Spin;
  phases: { phase: Phase; start: number; ms: number }[];
  /** The reel `t` milliseconds into the loop. */
  frame(t: number): Frame;
}

/** A whole loop: rest on Claude, spin to the last of `names`, rest there, roll on to Claude. */
export function buildCycle(timing: ReelTiming, names: number): Cycle {
  const spin = buildSpin(timing, names);
  let start = 0;
  const phases = (
    [
      ["hold", timing.hold],
      ["spin", spin.ms],
      ["acp", timing.acpHold],
      ["land", timing.land],
    ] as const
  ).map(([phase, length]) => {
    const ms = Math.max(1, length);
    const entry = { phase, start, ms };
    start += ms;
    return entry;
  });
  const ms = start;
  return {
    ms,
    spin,
    phases,
    frame(t) {
      const at = ((t % ms) + ms) % ms;
      const {
        phase,
        start,
        ms: length,
      } = phases.find((p) => at < p.start + p.ms) ?? phases[3];
      const u = clamp01((at - start) / length);
      const left = start + length - at;
      if (phase === "spin") return { phase, left, ...spin.at(u) };
      if (phase === "land")
        return {
          phase,
          left,
          position: names + easeInOut(u),
          speed: (easeInOutSlope(u) * 1000) / length,
        };
      return { phase, left, position: phase === "acp" ? names : 0, speed: 0 };
    },
  };
}
