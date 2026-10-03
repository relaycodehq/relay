export type Vec3 = readonly [number, number, number];
/** Column-major 4×4, as WebGL and CSS matrix3d() both take it. */
export type Mat4 = Float32Array | number[];

export const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const mix3 = (a: Vec3, b: Vec3, k: number): Vec3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
/** `v` turned by `angle` around the unit `axis`. */
export const rotate = (v: Vec3, axis: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(
    add(scale(v, c), scale(cross(axis, v), s)),
    scale(axis, dot(axis, v) * (1 - c)),
  );
};

export const clamp = (x: number, lo = 0, hi = 1) =>
  x < lo ? lo : x > hi ? hi : x;
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** 0 before `a`, 1 after `b`, linear between. */
export const span = (t: number, a: number, b: number) =>
  clamp((t - a) / (b - a));
export const smooth = (x: number) => {
  const k = clamp(x);
  return k * k * (3 - 2 * k);
};
export const smoother = (x: number) => {
  const k = clamp(x);
  return k * k * k * (k * (k * 6 - 15) + 10);
};
export const easeOut = (x: number, power = 3) => 1 - Math.pow(1 - clamp(x), power);
export const easeIn = (x: number, power = 3) => Math.pow(clamp(x), power);
export const easeInOut = (x: number, power = 3) => {
  const k = clamp(x);
  return k < 0.5
    ? Math.pow(2 * k, power) / 2
    : 1 - Math.pow(2 * (1 - k), power) / 2;
};
/** Overshoots a little past 1 before settling; for things that land. */
export const settle = (x: number, bounce = 1.4) => {
  const k = clamp(x) - 1;
  return 1 + k * k * ((bounce + 1) * k + bounce);
};
/** Rises over `a..b`, holds, falls over `c..d`. */
export const window4 = (t: number, a: number, b: number, c: number, d: number) =>
  Math.min(smooth(span(t, a, b)), 1 - smooth(span(t, c, d)));

/** Deterministic hash noise in 0..1, so a frame renders the same twice. */
export const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};
/** Smooth 1D value noise in -1..1. */
export const noise1 = (x: number, seed = 0) => {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(i + seed * 57.3);
  const b = hash(i + 1 + seed * 57.3);
  return lerp(a, b, f * f * (3 - 2 * f)) * 2 - 1;
};

export function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function multiply(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
  return out;
}

export function perspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): number[] {
  const f = 1 / Math.tan(fovY / 2);
  const d = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * d, -1,
    0, 0, 2 * far * near * d, 0,
  ];
}

/** View matrix for an eye at `eye` looking at `target`, rolled around the view axis. */
export function lookAt(eye: Vec3, target: Vec3, roll = 0): number[] {
  const f = norm(sub(target, eye));
  let r = norm(cross(f, [0, 1, 0]));
  let u = cross(r, f);
  if (roll) {
    r = rotate(r, f, roll);
    u = rotate(u, f, roll);
  }
  return [
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -dot(r, eye), -dot(u, eye), dot(f, eye), 1,
  ];
}

/** A basis (x, y, z columns) at `origin`. */
export function basis(x: Vec3, y: Vec3, z: Vec3, origin: Vec3): number[] {
  return [
    x[0], x[1], x[2], 0,
    y[0], y[1], y[2], 0,
    z[0], z[1], z[2], 0,
    origin[0], origin[1], origin[2], 1,
  ];
}

export function transformPoint(m: Mat4, p: Vec3): [number, number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  ];
}
