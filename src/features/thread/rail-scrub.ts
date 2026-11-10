/** Pixels between ticks while they fit; past that they close up to fit the
 * view, and on a long thread run together into a bar the pointer reads. */
const PITCH = 9;
/** Room below the last tick, at least, where a drag runs on through the
 * last turn to the thread's end. Past it the end is where it stays. */
export const RUN_OUT = 8;

/** A place in the thread a point on the rail stands for: a turn, and how far
 * through it, from its prompt (0) toward the next prompt, or for the last
 * turn the thread's end (1). */
export interface RailPlace {
  turn: number;
  through: number;
}

/** Pixels between ticks on a rail `room` tall. */
export function railPitch(room: number, turns: number) {
  return Math.max(0.5, Math.min(PITCH, (room - 48) / (turns - 1)));
}

/** The tick nearest to `y`, pixels below the first tick. */
export function tickAt(y: number, pitch: number, turns: number) {
  return Math.min(turns - 1, Math.max(0, Math.round(y / pitch)));
}

/** The place in the thread `y`, pixels below the first tick, scrubs to. */
export function railPlace(y: number, pitch: number, turns: number): RailPlace {
  const lastTick = (turns - 1) * pitch;
  if (y <= 0) return { turn: 0, through: 0 };
  if (y < lastTick) {
    const turn = Math.floor(y / pitch);
    return { turn, through: y / pitch - turn };
  }
  const runOut = Math.max(pitch, RUN_OUT);
  return { turn: turns - 1, through: Math.min(1, (y - lastTick) / runOut) };
}

/** The thread's end, once a drag has run all the way through the last turn. */
export function atThreadEnd(place: RailPlace, turns: number) {
  return place.turn === turns - 1 && place.through === 1;
}
