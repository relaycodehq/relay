import {
  accentRgb,
  drawFlat,
  easeInOut,
  easeOut,
  easeOutBack,
  film,
  fullCanvas,
  lerp,
  noise,
  plateRadius,
  span,
  type Grid,
} from "./stage";

const DURATION = 2850;
/** A moment of the film, in milliseconds into the opening. */
const at = (ms: number) => ms / DURATION;

// Ink: soaks in all over the code at once, spreading from scattered spots
// through the dark modules, each one going soft as the ink reaches it and
// bleeding a little past its edges, so the dark parts run together while
// the white between them stays open.
const SEEP = [40, 1000];
/** The share of dark modules the ink starts soaking in at. */
const SPOTS = 0.06;
const WET = 180;
const SOAK = 650;
/** Crossing a white module takes the ink this many times longer than a dark one. */
const PAPER = 6;
// Ferrofluid: the soaked code turns glossy, pulls into one drop and slithers
// over to pool in the middle.
const SHINE = [1150, 1400];
const GATHER = [1300, 1650];
const LEAVE = [1500, 1900];
const FLIGHT = 520;
const RIPPLE = [2250, 2450];
const BLOOM = [2100, 2500];
// The magnet: the pool snaps out into the big code and sets.
const SNAP = [2500, 2760];
const SET = [2530, 2800];
const FIELD = [2500, 2830];

const DROP = 0.42;
const POOL = 0.4;

let filters = 0;

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Blur, then a hard cut on alpha, and blocks that touch run together like
 * liquid. A low white light on the blurred shape catches only its curved
 * edges, so it reads as glossy black, and the shape's lower-right edge gets
 * an accent rim. The rim is the blurred shape minus itself shifted, not a
 * second light. Under Relay's renderer (Skia Graphite) a filter like this over
 * the whole window runs at ~15fps, so it only ever runs over the liquid.
 */
function liquidFilter(rim: string) {
  const id = `qr-ferro-${++filters}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.innerHTML = `
    <filter id="${id}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="1" result="blur" />
      <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6" result="goo" />
      <feGaussianBlur in="goo" stdDeviation="2" result="height" />
      <feSpecularLighting in="height" surfaceScale="8" specularConstant="0" specularExponent="30" lighting-color="#fff" result="key">
        <feDistantLight azimuth="225" elevation="32" />
      </feSpecularLighting>
      <feComposite in="key" in2="goo" operator="in" result="keyLit" />
      <feOffset in="height" dx="-3" dy="-4" result="lifted" />
      <feComposite in="height" in2="lifted" operator="out" result="edge" />
      <feFlood flood-color="${rim}" flood-opacity="0" result="tint" />
      <feComposite in="tint" in2="edge" operator="in" result="band" />
      <feComposite in="band" in2="goo" operator="in" result="rimLit" />
      <feMerge>
        <feMergeNode in="goo" />
        <feMergeNode in="rimLit" />
        <feMergeNode in="keyLit" />
      </feMerge>
    </filter>`;
  const region = svg.querySelector("filter")!;
  const [blur, height] = svg.querySelectorAll("feGaussianBlur");
  const key = svg.querySelector("feSpecularLighting")!;
  const tint = svg.querySelector("feFlood")!;
  return {
    svg,
    url: `url(#${id})`,
    /** `box` is where the liquid is, in window px; the filter runs there only. */
    set(sigma: number, shine: number, box: Box) {
      // Wider blurs cost more than they add to the shading.
      const soft = Math.min(sigma * 1.5 + 2, 7);
      const pad = 3 * (sigma + soft) + 6;
      region.setAttribute("x", String(box.x0 - pad));
      region.setAttribute("y", String(box.y0 - pad));
      region.setAttribute("width", String(box.x1 - box.x0 + 2 * pad));
      region.setAttribute("height", String(box.y1 - box.y0 + 2 * pad));
      blur.setAttribute("stdDeviation", String(sigma));
      height.setAttribute("stdDeviation", String(soft));
      key.setAttribute("specularConstant", String(2.2 * shine));
      tint.setAttribute("flood-opacity", String(0.9 * shine));
    },
  };
}

/**
 * How far the ink has to travel to each module from the nearest of `spots`:
 * a step per dark module, PAPER per white one, so it runs along the dark
 * parts and only slowly bridges the white.
 */
function seepDistances(grid: Grid, spots: number[]) {
  const n = grid.length;
  const dist = new Float64Array(n * n).fill(Infinity);
  for (const spot of spots) dist[spot] = 0;
  // A binary heap of [distance, module]; stale entries are skipped.
  const heap: [number, number][] = spots.map((spot) => [0, spot]);
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const push = (entry: [number, number]) => {
    heap.push(entry);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const r = Math.floor(i / n);
    const c = i % n;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if ((!dr && !dc) || rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const step = (grid[rr][cc] ? 1 : PAPER) * (dr && dc ? Math.SQRT2 : 1);
        const j = rr * n + cc;
        if (d + step < dist[j]) {
          dist[j] = d + step;
          push([d + step, j]);
        }
      }
  }
  return dist;
}

function roundSquare(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
) {
  ctx.beginPath();
  ctx.roundRect(cx - size / 2, cy - size / 2, size, size, plateRadius(size));
}

/** Squeezes a point of the square [-1, 1]² into the unit disc, so a drop is round. */
const toDisc = (a: number, b: number) =>
  [a * Math.sqrt(1 - (b * b) / 2), b * Math.sqrt(1 - (a * a) / 2)] as const;

/**
 * Ferrofluid: ink soaks into the code all over at once, through its dark
 * parts, until the whole code is wet; then it turns glossy, pulls
 * into one black drop, slithers across the window as a single tendril and
 * pools in the middle while the white plate blooms under it, and a magnet
 * snaps the liquid out into the big code.
 */
export const ferro = film(
  DURATION,
  ({ grid, from, to, layer }) => {
    const n = grid.length;
    const us = from.size / n;
    const u = to.size / n;
    const [ar, ag, ab] = accentRgb();
    const base = fullCanvas(layer);
    const liquid = fullCanvas(layer);
    const filter = liquidFilter(`rgb(${ar},${ag},${ab})`);
    layer.append(filter.svg);
    let filtered = false;
    const liquidOn = (on: boolean) => {
      if (on === filtered) return;
      filtered = on;
      liquid.canvas.style.filter = on ? filter.url : "";
    };

    const dark = grid.flatMap((row, r) =>
      row.flatMap((on, c) => (on ? [r * n + c] : [])),
    );
    const spots = dark.filter((i) => noise(i + 31) < SPOTS);
    const seep = seepDistances(grid, spots.length ? spots : dark.slice(0, 1));
    // Paced by most of the code, so one module stranded across white
    // doesn't slow the soak down for the rest.
    const reach =
      dark.map((i) => seep[i]).sort((a, b) => a - b)[
        Math.floor(dark.length * 0.95)
      ] || 1;

    const fx = from.x + from.size / 2;
    const fy = from.y + from.size / 2;
    const tx = to.x + to.size / 2;
    const ty = to.y + to.size / 2;
    const len = Math.hypot(tx - fx, ty - fy) || 1;
    const ux = (tx - fx) / len;
    const uy = (ty - fy) / len;
    const drops: {
      sx: number;
      sy: number;
      gx: number;
      gy: number;
      qx: number;
      qy: number;
      px: number;
      py: number;
      ex: number;
      ey: number;
      angle: number;
      wetAt: number;
      leave: number;
      settle: number;
    }[] = [];
    grid.forEach((row, r) =>
      row.forEach((on, c) => {
        if (!on) return;
        const i = r * n + c;
        const a = ((c + 0.5) / n) * 2 - 1;
        const b = ((r + 0.5) / n) * 2 - 1;
        const [da, db] = toDisc(a, b);
        const gx = fx + (da * from.size * DROP) / 2;
        const gy = fy + (db * from.size * DROP) / 2;
        const px = tx + (da * to.size * POOL) / 2;
        const py = ty + (db * to.size * POOL) / 2;
        // The front of the drop leaves first, so it stretches into a tendril.
        const along = (da * ux + db * uy + 1) / 2;
        const bend = len * (0.2 + 0.05 * (noise(i) - 0.5));
        drops.push({
          sx: from.x + (c + 0.5) * us,
          sy: from.y + (r + 0.5) * us,
          gx,
          gy,
          px,
          py,
          ex: to.x + (c + 0.5) * u,
          ey: to.y + (r + 0.5) * u,
          qx: (gx + px) / 2 - uy * bend,
          qy: (gy + py) / 2 + ux * bend,
          angle: Math.atan2(db, da),
          wetAt:
            at(lerp(SEEP[0], SEEP[1], Math.min(1, seep[i] / reach))) +
            at(80) * noise(i + 17),
          leave:
            at(lerp(LEAVE[0], LEAVE[1], 1 - along)) + at(60) * noise(i + 5),
          settle: (at(50) * Math.hypot(a, b)) / Math.SQRT2,
        });
      }),
    );

    return {
      render(t) {
        const ctx = base.clear();
        const wet = liquid.clear();
        if (t <= 0 || t >= 1) {
          drawFlat(ctx, grid, t <= 0 ? from : to);
          // Compiling the filter's shaders stalls one frame; spend that on
          // this still first frame rather than mid-seep.
          liquidOn(t <= 0);
          if (t <= 0) {
            filter.set(us * 0.6, 1, { x0: 0, y0: 0, x1: 2, y1: 2 });
            wet.fillStyle = "rgba(0,0,0,0.01)";
            wet.fillRect(0, 0, 2, 2);
          }
          return;
        }

        // The small plate shrinks away with the drop; the big one blooms
        // under the pool.
        const gather = easeInOut(span(t, at(GATHER[0]), at(GATHER[1])));
        if (gather < 1) {
          ctx.globalAlpha = 1 - gather;
          ctx.fillStyle = "#fff";
          roundSquare(ctx, fx, fy, from.size * lerp(1, DROP, gather));
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        const bloom = span(t, at(BLOOM[0]), at(BLOOM[1]));
        if (bloom > 0) {
          ctx.globalAlpha = easeOut(span(t, at(BLOOM[0]), at(BLOOM[0] + 120)));
          ctx.fillStyle = "#fff";
          roundSquare(ctx, tx, ty, to.size * lerp(0.3, 1, easeOutBack(bloom)));
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        // The magnet switching on.
        const field = span(t, at(FIELD[0]), at(FIELD[1]));
        if (field > 0 && field < 1) {
          ctx.strokeStyle = `rgba(${ar},${ag},${ab},${0.8 * (1 - field)})`;
          ctx.lineWidth = 2;
          roundSquare(ctx, tx, ty, to.size * (0.45 + 0.75 * easeOut(field)));
          ctx.stroke();
        }

        const set = easeOut(span(t, at(SET[0]), at(SET[1])));
        // While it waits in the pool, the edge of the liquid ripples.
        const ripple =
          span(t, at(RIPPLE[0]), at(RIPPLE[1])) *
          (1 - span(t, at(SNAP[0]), at(SNAP[0] + 100))) *
          0.05;
        // Once it's glossy, the ink swells until the white closes up and it's
        // one sheet, ready to pull into a drop.
        const merge = easeInOut(
          span(t, at(SHINE[0] + 150), at(GATHER[0] + 300)),
        );
        const dry = new Path2D();
        const soaked = new Path2D();
        const box = {
          x0: Infinity,
          y0: Infinity,
          x1: -Infinity,
          y1: -Infinity,
        };
        for (const d of drops) {
          let x = lerp(d.sx, d.gx, gather);
          let y = lerp(d.sy, d.gy, gather);
          let size = us;
          const fly = span(t, d.leave, d.leave + at(FLIGHT));
          if (fly > 0) {
            const e = easeInOut(fly);
            const a = 1 - e;
            // A slow S through the whole tendril, so it slithers.
            const sway =
              Math.sin(Math.PI * e) * Math.sin(3 * Math.PI * e) * len * 0.05;
            x = a * a * x + 2 * a * e * d.qx + e * e * d.px - uy * sway;
            y = a * a * y + 2 * a * e * d.qy + e * e * d.py + ux * sway;
            size = lerp(us, 0.5 * u, e);
          }
          if (ripple > 0 && fly >= 1) {
            const wave = 1 + ripple * Math.sin(d.angle * 5 + t * 60);
            x = tx + (x - tx) * wave;
            y = ty + (y - ty) * wave;
          }
          const snap = span(t, at(SNAP[0]) + d.settle, at(SNAP[1]) + d.settle);
          if (snap > 0) {
            const k = easeOutBack(snap);
            x = lerp(d.px, d.ex, k);
            y = lerp(d.py, d.ey, k);
            size = lerp(0.5 * u, u, easeOut(snap));
          }
          const wetness =
            easeOut(span(t, d.wetAt, d.wetAt + at(WET))) * (1 - set);
          if (wetness < 0.02) {
            dry.rect(x - size / 2, y - size / 2, size, size);
            continue;
          }
          const soak = easeInOut(span(t, d.wetAt, d.wetAt + at(SOAK)));
          const swell =
            size *
            (1 + (0.15 * wetness + 0.1 * soak + 1.05 * merge) * (1 - set));
          soaked.rect(x - swell / 2, y - swell / 2, swell, swell);
          box.x0 = Math.min(box.x0, x - swell / 2);
          box.y0 = Math.min(box.y0, y - swell / 2);
          box.x1 = Math.max(box.x1, x + swell / 2);
          box.y1 = Math.max(box.y1, y + swell / 2);
        }
        ctx.fillStyle = "#000";
        ctx.fill(dry);
        liquidOn(box.x1 > box.x0);
        if (box.x1 <= box.x0) return;

        const flowing = span(t, at(LEAVE[0]), at(LEAVE[1] + FLIGHT));
        filter.set(
          (1 - set) * lerp(us * lerp(0.45, 0.8, merge), 0.85 * u, flowing),
          easeInOut(span(t, at(SHINE[0]), at(SHINE[1]))) * (1 - set),
          box,
        );
        wet.fillStyle = "#050507";
        wet.fill(soaked);
      },
      dispose() {
        base.canvas.remove();
        liquid.canvas.remove();
        filter.svg.remove();
      },
    };
  },
  2.6,
);
