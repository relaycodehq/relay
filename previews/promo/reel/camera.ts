import { lookAt, multiply, noise1, perspective, type Vec3 } from "./math";

export interface CameraKey {
  t: number;
  eye: Vec3;
  target: Vec3;
  /** Radians around the view axis. */
  roll?: number;
  /** Vertical field of view, in degrees. */
  fov?: number;
}

export interface CameraState {
  eye: Vec3;
  target: Vec3;
  roll: number;
  fov: number;
  viewProj: number[];
}

const DEFAULT_FOV = 30;

/**
 * Monotone cubic through (times, values): it never overshoots a key, so the
 * camera settles where two keys agree and flows where they keep going.
 */
function monotone(times: number[], values: number[], t: number): number {
  const last = times.length - 1;
  if (t <= times[0]) return values[0];
  if (t >= times[last]) return values[last];
  let i = 0;
  while (i < last - 1 && times[i + 1] <= t) i++;
  const slope = (k: number) =>
    (values[k + 1] - values[k]) / (times[k + 1] - times[k]);
  const tangent = (k: number) => {
    if (k === 0) return slope(0);
    if (k === last) return slope(last - 1);
    const a = slope(k - 1);
    const b = slope(k);
    if (a * b <= 0) return 0;
    const wa = 2 * (times[k + 1] - times[k]) + (times[k] - times[k - 1]);
    const wb = times[k + 1] - times[k] + 2 * (times[k] - times[k - 1]);
    return (wa + wb) / (wa / a + wb / b);
  };
  const h = times[i + 1] - times[i];
  const k = (t - times[i]) / h;
  const k2 = k * k;
  const k3 = k2 * k;
  return (
    (2 * k3 - 3 * k2 + 1) * values[i] +
    (k3 - 2 * k2 + k) * h * tangent(i) +
    (-2 * k3 + 3 * k2) * values[i + 1] +
    (k3 - k2) * h * tangent(i + 1)
  );
}

export class Camera {
  private readonly times: number[];
  private readonly channels: number[][] = [];

  constructor(
    keys: CameraKey[],
    private readonly aspect: number,
  ) {
    this.times = keys.map((k) => k.t);
    for (let i = 0; i < 3; i++) this.channels.push(keys.map((k) => k.eye[i]));
    for (let i = 0; i < 3; i++) this.channels.push(keys.map((k) => k.target[i]));
    this.channels.push(keys.map((k) => k.roll ?? 0));
    this.channels.push(keys.map((k) => k.fov ?? DEFAULT_FOV));
  }

  at(t: number): CameraState {
    const [ex, ey, ez, tx, ty, tz, roll, fov] = this.channels.map((values) =>
      monotone(this.times, values, t),
    );
    // A tripod never holds perfectly still.
    const eye: Vec3 = [
      ex + noise1(t * 0.23, 1) * 9,
      ey + noise1(t * 0.19, 2) * 7,
      ez + noise1(t * 0.17, 3) * 12,
    ];
    const target: Vec3 = [tx, ty, tz];
    const tilt = roll + noise1(t * 0.13, 4) * 0.004;
    const projection = perspective((fov * Math.PI) / 180, this.aspect, 20, 40000);
    return {
      eye,
      target,
      roll: tilt,
      fov,
      viewProj: multiply(projection, lookAt(eye, target, tilt)),
    };
  }
}
