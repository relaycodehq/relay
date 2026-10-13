const signature = [137, 80, 78, 71, 13, 10, 26, 10];
/** Pixels and how to read them; text, EXIF, time stamps and colour profiles go. */
const kept = new Set(["IHDR", "PLTE", "tRNS", "sRGB", "gAMA", "IDAT", "IEND"]);

/**
 * The PNG with only the chunks that draw it, and its size. Null when the
 * bytes aren't a whole PNG. Chunks keep their own CRCs, so nothing is
 * re-encoded and the pixels are exactly the ones shown.
 */
export function cleanPng(bytes: Uint8Array) {
  if (bytes.length < 8 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let width = 0,
    height = 0,
    at = 8,
    ended = false;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (end > bytes.length) return null;
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
    }
    if (kept.has(type)) parts.push(bytes.subarray(at, end));
    at = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || !width || !height) return null;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return { bytes: out, width, height };
}
