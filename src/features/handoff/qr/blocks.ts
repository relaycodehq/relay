import {
  accentRgb,
  canvasEffect,
  easeInOut,
  easeOut,
  lerp,
  noise,
  span,
} from "./stage";

const TILT = 0.95;
const SLAB = 1.4;

const SIDES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/** A rounded square around the board's centre, in module units. */
function outline(half: number, radius: number) {
  const points: [number, number][] = [];
  const corners = [
    [half - radius, -half + radius, -Math.PI / 2],
    [half - radius, half - radius, 0],
    [-half + radius, half - radius, Math.PI / 2],
    [-half + radius, -half + radius, Math.PI],
  ];
  for (const [cx, cy, start] of corners)
    for (let k = 0; k <= 5; k++) {
      const a = start + (k / 5) * (Math.PI / 2);
      points.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
  return points;
}

/**
 * Block city: the code tips back into 3D, every module rises into a tower
 * with a lit roof, and the whole board orbits once while it flies to the
 * middle, then lies flat again with the towers sinking into it.
 */
export const blocks = canvasEffect(1700, ({ grid, from, to }) => {
  const n = grid.length;
  const half = n / 2;
  const camera = n * 2.6;
  const [ar, ag, ab] = accentRgb();
  const rim = outline(half, n * 0.036);
  const cells: {
    x: number;
    y: number;
    dist: number;
    height: number;
    rise: number;
    sink: number;
  }[] = [];
  grid.forEach((row, r) =>
    row.forEach((on, c) => {
      if (!on) return;
      const i = r * n + c;
      const x = c + 0.5 - half;
      const y = r + 0.5 - half;
      const dist = Math.hypot(x, y) / (half * Math.SQRT2);
      cells.push({
        x,
        y,
        dist,
        height: 0.6 + 3 * noise(i) ** 2,
        rise: 0.05 + 0.2 * dist + 0.05 * noise(i + 3),
        sink: 0.6 + 0.18 * dist,
      });
    }),
  );

  return (ctx, t) => {
    const move = easeInOut(span(t, 0.1, 0.72));
    const ox = lerp(from.x + from.size / 2, to.x + to.size / 2, move);
    const oy = lerp(from.y + from.size / 2, to.y + to.size / 2, move);
    const scale = lerp(from.size, to.size, move) / n;
    const tilt =
      TILT * (easeInOut(span(t, 0, 0.3)) - easeInOut(span(t, 0.7, 1)));
    const spin = -2 * Math.PI * easeInOut(span(t, 0.08, 0.95));
    const cz = Math.cos(spin);
    const sz = Math.sin(spin);
    const cx = Math.cos(tilt);
    const sx = Math.sin(tilt);

    // Board → camera space (x right, y down the screen, z towards the viewer).
    const view = (x: number, y: number, z: number) => {
      const xr = x * cz - y * sz;
      const yr = x * sz + y * cz;
      return [xr, yr * cx - z * sx, yr * sx + z * cx] as const;
    };
    const screen = ([x, y, z]: readonly [number, number, number]) => {
      const k = camera / (camera - z);
      return [ox + scale * k * x, oy + scale * k * y] as const;
    };
    const point = (x: number, y: number, z: number) => screen(view(x, y, z));
    const faces = (nx: number, ny: number, x: number, y: number, z: number) => {
      const nxr = nx * cz - ny * sz;
      const nyr = nx * sz + ny * cz;
      const [vx, vy, vz] = view(x, y, z);
      return (
        -vx * nxr - vy * nyr * cx + (camera - vz) * nyr * sx > 0 && {
          light: 0.5 - 0.35 * nxr - 0.25 * nyr,
        }
      );
    };
    const poly = (points: (readonly [number, number])[]) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    const gray = (light: number, from: number, to: number) => {
      const v = Math.round(lerp(from, to, light));
      return `rgb(${v},${v},${v + 6})`;
    };

    // The slab, with its edge showing and a shadow under it while tipped.
    const lift = Math.sin(tilt);
    const top = rim.map(([x, y]) => point(x, y, 0));
    const bottom = rim.map(([x, y]) => point(x, y, -SLAB));
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 60 * lift;
    ctx.shadowOffsetY = 40 * lift;
    ctx.fillStyle = "#b9b9c2";
    poly(bottom);
    ctx.fill();
    ctx.restore();
    rim.forEach(([x1, y1], i) => {
      const [x2, y2] = rim[(i + 1) % rim.length];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const face = faces(
        (y2 - y1) / len,
        -(x2 - x1) / len,
        (x1 + x2) / 2,
        (y1 + y2) / 2,
        -SLAB / 2,
      );
      if (!face) return;
      ctx.fillStyle = gray(face.light, 170, 225);
      poly([
        top[i],
        top[(i + 1) % rim.length],
        bottom[(i + 1) % rim.length],
        bottom[i],
      ]);
      ctx.fill();
    });
    ctx.fillStyle = "#fff";
    poly(top);
    ctx.fill();

    const flat = new Path2D();
    const towers: { cell: (typeof cells)[number]; h: number; far: number }[] =
      [];
    for (const cell of cells) {
      const up = easeOut(span(t, cell.rise, cell.rise + 0.2));
      const down = easeInOut(span(t, cell.sink, cell.sink + 0.22));
      const pulse = 0.8 + 0.2 * Math.sin(cell.dist * 14 - t * 20);
      const h = cell.height * up * (1 - down) * pulse;
      if (h < 0.02) {
        const corners = [
          point(cell.x - 0.5, cell.y - 0.5, 0),
          point(cell.x + 0.5, cell.y - 0.5, 0),
          point(cell.x + 0.5, cell.y + 0.5, 0),
          point(cell.x - 0.5, cell.y + 0.5, 0),
        ];
        corners.forEach(([x, y], i) =>
          i ? flat.lineTo(x, y) : flat.moveTo(x, y),
        );
        flat.closePath();
        continue;
      }
      const [vx, vy, vz] = view(cell.x, cell.y, h / 2);
      towers.push({ cell, h, far: vx * vx + vy * vy + (camera - vz) ** 2 });
    }
    ctx.fillStyle = "#000";
    ctx.fill(flat);

    towers.sort((a, b) => b.far - a.far);
    for (const { cell, h } of towers) {
      const { x, y } = cell;
      const base = [
        [x - 0.5, y - 0.5],
        [x + 0.5, y - 0.5],
        [x + 0.5, y + 0.5],
        [x - 0.5, y + 0.5],
      ];
      const low = base.map(([bx, by]) => point(bx, by, 0));
      const high = base.map(([bx, by]) => point(bx, by, h));
      SIDES.forEach(([nx, ny], i) => {
        // Side i runs between corners i+1 and i+2 of the base.
        const a = (i + 1) % 4;
        const b = (i + 2) % 4;
        const face = faces(nx, ny, x + nx / 2, y + ny / 2, h / 2);
        if (!face) return;
        ctx.fillStyle = gray(face.light, 18, 80);
        poly([low[a], low[b], high[b], high[a]]);
        ctx.fill();
      });
      const glow = Math.min(1, h / 2.2);
      ctx.fillStyle = `rgb(${ar * glow},${ag * glow},${ab * glow})`;
      poly(high);
      ctx.fill();
    }
  };
});
