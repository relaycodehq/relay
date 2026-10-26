import { nativeImage } from "electron";

/**
 * Windows has no badge count; a dot on the taskbar button stands in. The
 * overlay is always a 16px square on the icon's corner, so a dot filling it
 * reads as big as the icon; Windows' own unread dots are about half that.
 */
export function badgeDot() {
  const size = 16,
    radius = 4.5,
    pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2),
        alpha = Math.max(0, Math.min(1, radius + 0.5 - d)),
        i = (y * size + x) * 4;
      // BGRA, premultiplied: #e5484d with an antialiased edge.
      pixels[i] = Math.round(0x4d * alpha);
      pixels[i + 1] = Math.round(0x48 * alpha);
      pixels[i + 2] = Math.round(0xe5 * alpha);
      pixels[i + 3] = Math.round(0xff * alpha);
    }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}
