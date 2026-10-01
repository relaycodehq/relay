// The teaser's clock. Live, it follows requestAnimationFrame; the recorder
// seeks it frame by frame instead, so every frame is a function of time alone.
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export const DURATION = 58_000;
/** Wall-clock time at t = 0, for the timestamps the app components print. */
export const EPOCH = new Date("2026-09-25T14:32:00").getTime();

let now = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTime = () => useSyncExternalStore(subscribe, () => now);

// Components that tick on their own (elapsed labels, thinking words) read the
// scene's time, not the machine's.
Date.now = () => EPOCH + now;

function publish(t: number) {
  now = t;
  for (const listener of listeners) listener();
}

// CSS animations and transitions (spinners, shimmers, the app's own fades)
// run on the page's clock. Paused and set from t, they land on the same frame
// every time.
const born = new WeakMap<Animation, number>();
function syncAnimations(t: number) {
  for (const animation of document.getAnimations()) {
    if (!born.has(animation)) born.set(animation, t);
    // Seeking back past an animation's start means it ran long ago.
    else if (born.get(animation)! > t) born.set(animation, t - 60_000);
    animation.pause();
    animation.currentTime = Math.max(0, t - born.get(animation)!);
  }
}

/** Renders frame t synchronously; the recorder screenshots right after. */
export async function seek(t: number) {
  flushSync(() => publish(t));
  syncAnimations(t);
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

export function play(loop = true) {
  const start = performance.now() - now;
  const tick = () => {
    let t = performance.now() - start;
    if (t > DURATION && !loop) return;
    t %= DURATION;
    publish(t);
    frame = requestAnimationFrame(tick);
  };
  let frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

declare global {
  interface Window {
    teaser?: { seek: typeof seek; duration: number; ready: Promise<void> };
  }
}

export const clamp = (v: number, lo = 0, hi = 1) =>
  Math.min(hi, Math.max(lo, v));
/** 0 before `from`, 1 after `to`, linear in between. */
export const span = (t: number, from: number, to: number) =>
  clamp((t - from) / (to - from));
export const mixN = (a: number, b: number, p: number) => a + (b - a) * p;

export const ease = {
  inOut: (p: number) =>
    p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
  out: (p: number) => 1 - Math.pow(1 - p, 3),
  outExpo: (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  in: (p: number) => p * p * p,
  // Gentle overshoot for things that land.
  outBack: (p: number) => {
    const c = 1.4;
    return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
  },
  /** Smooth start and stop without cubic's long flat tails. */
  sine: (p: number) => -(Math.cos(Math.PI * p) - 1) / 2,
};

/** Rises from 0 to 1 over [from, from + rise] and falls back over [to - fall, to]. */
export function presence(
  t: number,
  from: number,
  to: number,
  rise = 500,
  fall = 400,
) {
  if (t < from || t > to) return 0;
  return Math.min(
    ease.out(span(t, from, from + rise)),
    1 - ease.in(span(t, to - fall, to)),
  );
}

type Frame<T> = { at: number } & T;

/** Interpolates numeric fields between keyframes, eased per segment. */
export function keyframes<T extends Record<string, number>>(
  t: number,
  frames: Frame<T>[],
  easing: (p: number) => number = ease.inOut,
): T {
  const { at: _, ...first } = frames[0];
  if (t <= frames[0].at) return first as unknown as T;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1],
      b = frames[i];
    if (t <= b.at) {
      const p = easing(span(t, a.at, b.at));
      const out: Record<string, number> = {};
      for (const key of Object.keys(b)) {
        if (key === "at") continue;
        out[key] = mixN(
          a[key as keyof T] as number,
          b[key as keyof T] as number,
          p,
        );
      }
      return out as T;
    }
  }
  const { at: __, ...last } = frames[frames.length - 1];
  return last as unknown as T;
}

/** The first n characters of text at time t, typed at `cps` with a little rhythm. */
export function typed(text: string, t: number, from: number, cps = 32) {
  if (t < from) return "";
  const n = Math.floor(((t - from) / 1000) * cps);
  return text.slice(0, n);
}
