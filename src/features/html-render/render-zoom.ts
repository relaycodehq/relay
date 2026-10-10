export interface Size {
  width: number;
  height: number;
}

const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const MAX = STEPS[STEPS.length - 1];

/**
 * How much larger an expanded page shows than in the thread: as large as it
 * fits whole, but a page taller than the window keeps at least its own size
 * and scrolls, rather than shrinking out of reading.
 */
export function fitZoom(page: Size, stage: Size) {
  if (!(page.width > 0 && page.height > 0)) return 1;
  const across = stage.width / page.width;
  const down = stage.height / page.height;
  const zoom = Math.min(across, Math.max(down, 1), MAX);
  return Math.floor(zoom * 100) / 100;
}

/** The next step up (1) or down (-1) from `zoom`. */
export function stepZoom(zoom: number, direction: 1 | -1) {
  const next =
    direction > 0
      ? STEPS.find((step) => step > zoom + 0.01)
      : STEPS.findLast((step) => step < zoom - 0.01);
  return next ?? zoom;
}
