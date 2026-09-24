/** How an image sits in the viewer: scaled about its centre, then moved by x/y screen pixels from the stage's centre. */
export interface ImageView {
  scale: number;
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}

export const MAX_SCALE = 16;
/** Room kept around a fitted image so it doesn't touch the stage's edges. */
const FIT_MARGIN = 24;

/** The scale that shows all of the image, never enlarging one that already fits. */
export function fitScale(image: Size, stage: Size) {
  if (!image.width || !image.height) return 1;
  return Math.min(
    1,
    Math.max(0, stage.width - FIT_MARGIN * 2) / image.width,
    Math.max(0, stage.height - FIT_MARGIN * 2) / image.height,
  );
}

/** Keeps a zoomed image covering the stage, and centres it along any side that fits. */
export function clampView(
  view: ImageView,
  image: Size,
  stage: Size,
): ImageView {
  const slackX = Math.max(0, (image.width * view.scale - stage.width) / 2);
  const slackY = Math.max(0, (image.height * view.scale - stage.height) / 2);
  return {
    scale: view.scale,
    x: Math.min(slackX, Math.max(-slackX, view.x)),
    y: Math.min(slackY, Math.max(-slackY, view.y)),
  };
}

/**
 * Scales to `scale` while the image point under `at` (relative to the stage's
 * centre) stays put. Zooming out stops at the fitted size.
 */
export function zoomTo(
  view: ImageView,
  scale: number,
  at: { x: number; y: number },
  image: Size,
  stage: Size,
): ImageView {
  const next = Math.min(MAX_SCALE, Math.max(fitScale(image, stage), scale));
  const ratio = next / view.scale;
  return clampView(
    {
      scale: next,
      x: at.x - (at.x - view.x) * ratio,
      y: at.y - (at.y - view.y) * ratio,
    },
    image,
    stage,
  );
}

/** The next preset zoom step in or out, so buttons and keys land on round numbers. */
export function stepScale(scale: number, direction: 1 | -1) {
  const steps = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
  const next =
    direction > 0
      ? steps.find((step) => step > scale * 1.01)
      : [...steps].reverse().find((step) => step < scale * 0.99);
  return next ?? (direction > 0 ? MAX_SCALE : scale);
}
