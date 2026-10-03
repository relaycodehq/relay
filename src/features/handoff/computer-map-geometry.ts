// Pixel geometry, shared by the boxes and the wires between them.
export const mapW = 600,
  selfW = 168,
  nodeW = 214,
  nodeH = 62,
  addH = 42;
const gap = 12,
  pad = 22;

/**
 * Where everything sits on the map: this computer centred on the left, a
 * column of boxes `heights` tall on the right, and a wire out to each.
 */
export function mapLayout(heights: number[]) {
  const tops: number[] = [];
  let y = pad;
  for (const h of heights) {
    tops.push(y);
    y += h + gap;
  }
  const height = Math.max(y - gap + pad, nodeH + pad * 2);
  const selfY = height / 2;
  const x0 = selfW,
    x1 = mapW - nodeW;
  const mid = (i: number) => tops[i]! + heights[i]! / 2;
  const bend = (x1 - x0) * 0.55;
  const wire = (to: number) =>
    `M ${x0} ${selfY} C ${x0 + bend} ${selfY}, ${x1 - bend} ${to}, ${x1} ${to}`;
  /** A point on the wire to `to`, `t` of the way along. */
  const at = (to: number, t: number) => {
    const u = 1 - t;
    const b = (p: number[]) =>
      u * u * u * p[0]! +
      3 * u * u * t * p[1]! +
      3 * u * t * t * p[2]! +
      t * t * t * p[3]!;
    return {
      x: b([x0, x0 + bend, x1 - bend, x1]),
      y: b([selfY, selfY, to, to]),
    };
  };
  return { tops, height, selfY, x1, mid, wire, at };
}
