import { encode } from "uqr";

export type Grid = boolean[][];
/** A square on screen, in CSS px. */
export type Square = { x: number; y: number; size: number };

export type QrStage = {
  grid: Grid;
  /** The small code the user clicked. */
  from: Square;
  /** Where the enlarged code settles, on whole pixels per module. */
  to: Square;
  /** Full-window layer the effect draws into. */
  layer: HTMLElement;
};

export type QrPlayer = {
  /** Runs towards the enlarged code (1) or back to the small one (-1). */
  play(direction: 1 | -1): Promise<void>;
  dispose(): void;
};

export type QrEffect = (stage: QrStage) => QrPlayer;

export const qrGrid = (text: string): Grid =>
  encode(text, { ecc: "M", border: 2 }).data;

export function modulePath(grid: Grid) {
  let d = "";
  grid.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return d;
}

export const plateRadius = (size: number) => size * 0.036;

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress through the [a, b] slice of `t`. */
export const span = (t: number, a: number, b: number) =>
  clamp01((t - a) / (b - a));
export const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Overshoots a little past 1 and settles back. */
export const easeOutBack = (t: number) =>
  1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

/** Stable noise in [0, 1) per index, so a code always breaks up the same way. */
export const noise = (i: number) => {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/** The theme's accent as rgb, whatever format the token is written in. */
export function accentRgb(): [number, number, number] {
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.fillStyle = "#aaa8e5";
  probe.fillStyle =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim() || "#aaa8e5";
  const hex = String(probe.fillStyle);
  if (hex.startsWith("#"))
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  const [r, g, b] = hex.match(/[\d.]+/g)!.map(Number);
  return [r, g, b];
}

/** The code lying flat: white plate, dark modules merged into row runs. */
export function drawFlat(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  { x, y, size }: Square,
) {
  const n = grid.length;
  const u = size / n;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, plateRadius(size));
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  grid.forEach((row, r) => {
    for (let c = 0; c < n;) {
      if (!row[c]) {
        c++;
        continue;
      }
      let end = c;
      while (end < n && row[end]) end++;
      ctx.rect(x + c * u, y + r * u, (end - c) * u, u);
      c = end;
    }
  });
  ctx.fill();
}

/** A canvas over the whole window at device resolution, drawn in CSS px. */
export function fullCanvas(layer: HTMLElement) {
  const width = innerWidth;
  const height = innerHeight;
  const dpr = devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.cssText = `position:absolute;inset:0;width:${width}px;height:${height}px`;
  layer.append(canvas);
  const ctx = canvas.getContext("2d")!;
  return {
    canvas,
    /** The context, wiped and ready for the next frame. */
    clear() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      return ctx;
    },
  };
}

/**
 * An effect as a short film: `setup` builds the scene once and renders it at
 * any progress; opening plays 0 to 1, closing plays the same film backwards,
 * faster.
 */
export function film(
  duration: number,
  setup: (stage: QrStage) => { render(t: number): void; dispose(): void },
  closeSpeed = 2.2,
): QrEffect {
  return (stage) => {
    const scene = setup(stage);
    let t = 0;
    let raf = 0;
    scene.render(t);
    return {
      play(direction) {
        cancelAnimationFrame(raf);
        const speed = direction > 0 ? 1 : closeSpeed;
        const goal = direction > 0 ? 1 : 0;
        return new Promise((resolve) => {
          let last = performance.now();
          const tick = (now: number) => {
            // A stalled frame pauses the film rather than skipping ahead.
            const step = Math.min(50, Math.max(0, now - last));
            t = clamp01(t + (direction * speed * step) / duration);
            last = now;
            scene.render(t);
            if (t === goal) resolve();
            else raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        });
      },
      dispose() {
        cancelAnimationFrame(raf);
        scene.dispose();
      },
    };
  };
}

/** A film drawn on one canvas, starting and ending on the code lying flat. */
export function canvasEffect(
  duration: number,
  setup: (stage: QrStage) => (ctx: CanvasRenderingContext2D, t: number) => void,
  closeSpeed = 2.2,
): QrEffect {
  return film(
    duration,
    (stage) => {
      const { canvas, clear } = fullCanvas(stage.layer);
      const frame = setup(stage);
      return {
        render(t) {
          const ctx = clear();
          if (t <= 0) drawFlat(ctx, stage.grid, stage.from);
          else if (t >= 1) drawFlat(ctx, stage.grid, stage.to);
          else frame(ctx, t);
        },
        dispose: () => canvas.remove(),
      };
    },
    closeSpeed,
  );
}

/** No motion: the enlarged code is simply there, and simply gone. */
export const still = canvasEffect(1, () => () => {});
