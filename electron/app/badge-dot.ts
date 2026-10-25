import { nativeImage } from "electron";

/** Windows has no badge count; a dot on the taskbar button stands in. */
export function badgeDot() {
  const size = 16,
    pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2),
        alpha = Math.max(0, Math.min(1, size / 2 - d)),
        i = (y * size + x) * 4;
      // BGRA, premultiplied: #e5484d with an antialiased edge.
      pixels[i] = Math.round(0x4d * alpha);
      pixels[i + 1] = Math.round(0x48 * alpha);
      pixels[i + 2] = Math.round(0xe5 * alpha);
      pixels[i + 3] = Math.round(0xff * alpha);
    }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}
