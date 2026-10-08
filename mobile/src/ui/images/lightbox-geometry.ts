/** Pan limits for an image contained in the current page, then zoomed about its centre. */
export function imageLimits(
  ratio: number,
  width: number,
  height: number,
  scale: number,
) {
  "worklet";
  const fitted = ratio ? Math.min(width, height * ratio) : width;
  return {
    x: Math.max(0, (fitted * scale - width) / 2),
    y: Math.max(0, ((ratio ? fitted / ratio : height) * scale - height) / 2),
  };
}
