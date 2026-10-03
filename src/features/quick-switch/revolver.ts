/**
 * The revolver quick switch's cylinder: how far it turns for each change, and
 * which chambers reach the notch as it moves, so each one clicks as it does.
 */

/** Whole extra turns when the switcher opens, and when a step wraps past the end. */
const openTurns = 1;
const overspinTurns = 2;

type CylinderMotion = "step" | "spin" | "overspin";

export interface Cylinder {
  index: number;
  open: boolean;
  /** Degrees, never reset, so every turn carries on the way it was going. */
  rot: number;
  motion: CylinderMotion;
}

export const restingCylinder = (
  index: number,
  open: boolean,
  chambers: number,
): Cylinder => ({
  index,
  open,
  rot: (-index * 360) / chambers,
  motion: "step",
});

/**
 * Turns from `from` to show `index`. A step against its direction wrapped
 * round the list, so the cylinder carries on the same way and overspins.
 * Opening adds a whole turn, like flicking the cylinder.
 */
export function turnCylinder(
  from: Cylinder,
  index: number,
  open: boolean,
  dir: number,
  chambers: number,
): Cylinder {
  let delta = index - from.index;
  const wrapped = (dir > 0 && delta < 0) || (dir < 0 && delta > 0);
  if (wrapped) delta += dir > 0 ? chambers : -chambers;
  const opened = open && !from.open;
  const turns = wrapped ? overspinTurns : opened ? openTurns : 0;
  const way = Math.sign(delta || dir || 1);
  return {
    index,
    open,
    rot: from.rot - (delta + way * turns * chambers) * (360 / chambers),
    motion: wrapped ? "overspin" : opened ? "spin" : "step",
  };
}

/**
 * The chambers that reached the notch as the cylinder moved to `position`
 * (in chambers, growing as it turns forward). `last` clicked before; going
 * back past it, as in the bounce at a stop, doesn't click it again.
 */
export function chambersReached(last: number, position: number, way: 1 | -1) {
  // `|| 0` keeps Math.ceil's -0 out.
  const at =
    (way > 0 ? Math.floor(position + 1e-3) : Math.ceil(position - 1e-3)) || 0;
  const count = Math.max(0, (at - last) * way);
  return { last: count ? at : last, count };
}

/** `degrees` folded into -180–180, for following an angle frame to frame. */
export const foldAngle = (degrees: number) =>
  ((((degrees + 180) % 360) + 360) % 360) - 180;
