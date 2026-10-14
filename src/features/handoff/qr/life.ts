import {
  accentRgb,
  canvasEffect,
  easeInOut,
  easeOut,
  lerp,
  noise,
  plateRadius,
  span,
  type Grid,
} from "./stage";

const GENERATIONS = 48;
/** Dead cells of room around the code; gliders get about this far in 48 steps. */
const PAD = 16;
const FORWARD = [0.04, 0.44];
const JAM = [0.44, 0.52];
const REWIND = [0.52, 0.94];

/** Every generation of Conway's Life, starting from the code's dark modules. */
function lifeline(grid: Grid) {
  const n = grid.length;
  const w = n + 2 * PAD;
  let cells = new Uint8Array(w * w);
  grid.forEach((row, r) =>
    row.forEach((on, c) => {
      if (on) cells[(r + PAD) * w + c + PAD] = 1;
    }),
  );
  const generations = [cells];
  for (let g = 0; g < GENERATIONS; g++) {
    const next = new Uint8Array(w * w);
    for (let r = 0; r < w; r++)
      for (let c = 0; c < w; c++) {
        let around = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if ((dr || dc) && rr >= 0 && cc >= 0 && rr < w && cc < w)
              around += cells[rr * w + cc];
          }
        const i = r * w + c;
        next[i] = around === 3 || (around === 2 && cells[i]) ? 1 : 0;
      }
    generations.push(next);
    cells = next;
  }
  return { w, generations };
}

/**
 * Game of Life: the code comes alive. Its plate opens into a petri dish and
 * the dark modules live, die and breed for 48 generations while it flies to
 * the middle; then the tape jams, and time runs backwards until the chaos
 * un-evolves into the big code.
 */
export const life = canvasEffect(2800, ({ grid, from, to }) => {
  const n = grid.length;
  const us = from.size / n;
  const u = to.size / n;
  const { w, generations } = lifeline(grid);
  const [ar, ag, ab] = accentRgb();
  // Deep enough to read on the white dish in either theme.
  const newborn = `rgb(${ar * 0.8},${ag * 0.8},${ab * 0.8})`;
  const fit = (Math.min(innerWidth, innerHeight) * 0.86) / w;
  const fx = from.x + from.size / 2;
  const fy = from.y + from.size / 2;
  const tx = to.x + to.size / 2;
  const ty = to.y + to.size / 2;

  return (ctx, t) => {
    const forward = span(t, FORWARD[0], FORWARD[1]);
    const back = easeInOut(span(t, REWIND[0], REWIND[1]));
    // Slow first steps, so the code is seen twitching to life.
    const gen = GENERATIONS * forward ** 1.6 * (1 - back);
    const move = easeInOut(span(t, 0, 0.32));
    const grow = easeInOut(span(t, 0.58, 0.95));
    const cell = lerp(lerp(us, fit, move), u, grow);
    const cx = lerp(fx, tx, move);
    const cy = lerp(fy, ty, move);
    const ox = cx - (w / 2) * cell;
    const oy = cy - (w / 2) * cell;

    const open =
      easeOut(span(t, 0.03, 0.2)) * (1 - easeInOut(span(t, 0.88, 0.97)));
    const dish = (n + 2 * PAD * open) * cell;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.roundRect(cx - dish / 2, cy - dish / 2, dish, dish, plateRadius(dish));
    ctx.fill();

    // The tape jamming: bands of rows slip sideways for a moment.
    const jam = Math.sin(Math.PI * span(t, JAM[0], JAM[1]));
    const step = Math.floor(t * 60);
    const slip = (r: number) =>
      jam * cell * 4 * (noise(Math.floor(r / 3) * 7 + step) - 0.5);

    const lo = Math.floor(gen);
    const hi = Math.min(GENERATIONS, lo + 1);
    const f = gen - lo;
    const now = generations[lo];
    const next = generations[hi];
    const staying = new Path2D();
    const coming = new Path2D();
    const going = new Path2D();
    for (let r = 0; r < w; r++) {
      const y = oy + r * cell;
      const x0 = ox + slip(r);
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        const a = now[i];
        const b = next[i];
        if (!a && !b) continue;
        (a && b ? staying : b ? coming : going).rect(
          x0 + c * cell,
          y,
          cell,
          cell,
        );
      }
    }
    ctx.fillStyle = "#000";
    ctx.fill(staying);
    ctx.globalAlpha = 1 - f;
    ctx.fill(going);
    ctx.globalAlpha = f;
    ctx.fillStyle = newborn;
    ctx.fill(coming);
    ctx.globalAlpha = 1;

    // A VCR's on-screen display, for the full effect.
    if (open > 0.5) {
      const rewinding = t >= JAM[0];
      ctx.globalAlpha = Math.min(1, (open - 0.5) * 4);
      ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
      ctx.font = "600 12px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(
        `${rewinding ? "◀◀ REW" : "PLAY ▶"}   GEN ${String(Math.round(gen)).padStart(2, "0")}`,
        cx - dish / 2,
        cy - dish / 2 - 10,
      );
      ctx.globalAlpha = 1;
    }
  };
});
