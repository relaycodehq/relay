/** Pixels between ticks while they fit; past that they close up to fit the
 * view, and on a long thread run together into a bar the pointer reads. */
const PITCH = 9;

/** Pixels between ticks on a rail `room` tall. */
export function railPitch(room: number, turns: number) {
  return Math.max(0.5, Math.min(PITCH, (room - 48) / (turns - 1)));
}

/** The tick nearest to `y`, pixels below the first tick. */
export function tickAt(y: number, pitch: number, turns: number) {
  return Math.min(turns - 1, Math.max(0, Math.round(y / pitch)));
}
