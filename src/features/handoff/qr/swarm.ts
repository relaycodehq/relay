import {
  accentRgb,
  canvasEffect,
  easeInOut,
  easeOut,
  lerp,
  noise,
  plateRadius,
  span,
} from "./stage";

const SWEEP = 0.46;
const JITTER = 0.08;
const FLIGHT = 0.42;
const GLOW = 0.1;
const FAR = 1e4;

/** Keeps the side of the line x + y = k (in `ox`/`oy`-relative px) given by `side`. */
function diagonalClip(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  k: number,
  side: 1 | -1,
) {
  const ax = ox + k + FAR;
  const ay = oy - FAR;
  const bx = ox + k - FAR;
  const by = oy + FAR;
  const push = 2 * FAR * side;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + push, by + push);
  ctx.lineTo(ax + push, ay + push);
  ctx.clip();
}

function quad(
  path: Path2D,
  cx: number,
  cy: number,
  half: number,
  angle: number,
) {
  const c = Math.cos(angle) * half;
  const s = Math.sin(angle) * half;
  path.moveTo(cx - c + s, cy - s - c);
  path.lineTo(cx + c + s, cy + s - c);
  path.lineTo(cx + c - s, cy + s + c);
  path.lineTo(cx - c - s, cy - s + c);
  path.closePath();
}

/**
 * Nanotech: every module lifts off the small code in a diagonal sweep,
 * streams across the window on a curl and is printed into the big one, its
 * white plate laid down behind the landing edge.
 */
export const swarm = canvasEffect(1500, ({ grid, from, to }) => {
  const n = grid.length;
  const us = from.size / n;
  const u = to.size / n;
  const [ar, ag, ab] = accentRgb();
  const accent = (a: number) => `rgba(${ar},${ag},${ab},${a})`;
  const diagonals = 2 * n - 2;
  const motes: {
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    ex: number;
    ey: number;
    delay: number;
    spin: number;
  }[] = [];
  grid.forEach((row, r) =>
    row.forEach((on, c) => {
      if (!on) return;
      const i = r * n + c;
      const sx = from.x + (c + 0.5) * us;
      const sy = from.y + (r + 0.5) * us;
      const ex = to.x + (c + 0.5) * u;
      const ey = to.y + (r + 0.5) * u;
      const dx = ex - sx;
      const dy = ey - sy;
      const curl = 0.18 + 0.32 * noise(i);
      motes.push({
        sx,
        sy,
        ex,
        ey,
        cx: (sx + ex) / 2 - dy * curl,
        cy: (sy + ey) / 2 + dx * curl,
        delay: (SWEEP * (c + r)) / diagonals + JITTER * noise(i + 7),
        spin: (noise(i + 13) - 0.5) * 2 * Math.PI,
      });
    }),
  );

  return (ctx, t) => {
    // What is left of the small plate, eaten from the corner the swarm leaves.
    const launched = (t / SWEEP) * diagonals;
    if (launched < diagonals + 2) {
      ctx.save();
      diagonalClip(ctx, from.x, from.y, launched * us, 1);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.roundRect(
        from.x,
        from.y,
        from.size,
        from.size,
        plateRadius(from.size),
      );
      ctx.fill();
      ctx.restore();
    }

    // The big plate, printed in behind the landing edge.
    const landed = ((t - FLIGHT) / SWEEP) * diagonals;
    if (landed > -2) {
      const edge = (landed + 2) * u;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(to.x, to.y, to.size, to.size, plateRadius(to.size));
      ctx.clip();
      ctx.save();
      diagonalClip(ctx, to.x, to.y, edge, -1);
      ctx.fillStyle = "#fff";
      ctx.fillRect(to.x, to.y, to.size, to.size);
      ctx.restore();
      if (edge < to.size * 2) {
        ctx.strokeStyle = accent(0.9);
        ctx.lineWidth = 2;
        ctx.shadowColor = accent(1);
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(to.x + edge, to.y);
        ctx.lineTo(to.x, to.y + edge);
        ctx.stroke();
      }
      ctx.restore();
    }

    const resting = new Path2D();
    const fresh = [new Path2D(), new Path2D(), new Path2D()];
    const flying = new Path2D();
    const trails = new Path2D();
    for (const m of motes) {
      const p = span(t, m.delay, m.delay + FLIGHT);
      if (p <= 0) {
        resting.rect(m.sx - us / 2, m.sy - us / 2, us, us);
        continue;
      }
      if (p >= 1) {
        resting.rect(m.ex - u / 2, m.ey - u / 2, u, u);
        const age = (t - m.delay - FLIGHT) / GLOW;
        if (age < 1)
          fresh[Math.floor(age * 3)].rect(m.ex - u / 2, m.ey - u / 2, u, u);
        continue;
      }
      for (const [path, back, shrink] of [
        [trails, 0.07, 0.7],
        [flying, 0, 1],
      ] as const) {
        const q = Math.max(0, p - back);
        const e = easeInOut(q);
        const a = 1 - e;
        const x = a * a * m.sx + 2 * a * e * m.cx + e * e * m.ex;
        const y = a * a * m.sy + 2 * a * e * m.cy + e * e * m.ey;
        const size =
          lerp(us, u, easeOut(q)) * (1 - 0.55 * Math.sin(Math.PI * q)) * shrink;
        quad(path, x, y, size / 2, m.spin * Math.sin(Math.PI * q));
      }
    }
    ctx.fillStyle = "#000";
    ctx.fill(resting);
    fresh.forEach((path, i) => {
      ctx.fillStyle = accent(1 - i / 3);
      ctx.fill(path);
    });
    ctx.fillStyle = accent(0.3);
    ctx.fill(trails);
    ctx.fillStyle = accent(0.95);
    ctx.fill(flying);
  };
});
