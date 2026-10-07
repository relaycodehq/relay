import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { encodeJpeg } from "./jpeg";
import { decodePng } from "./png";

/**
 * nativeImage without a graphics stack: PNGs and JPEGs are read for their
 * size and handed on as they are, never resized. Phones then get project
 * icons and attached images whole; everything else reads as empty, which
 * every caller already treats as "show nothing" or "send the original".
 */
export class HeadlessImage {
  private constructor(
    private bytes: Buffer | null,
    private mime: "image/png" | "image/jpeg" | null,
    private size: { width: number; height: number },
  ) {}

  static empty() {
    return new HeadlessImage(null, null, { width: 0, height: 0 });
  }

  static fromBuffer(bytes: Buffer) {
    const png = pngSize(bytes);
    if (png) return new HeadlessImage(bytes, "image/png", png);
    const jpeg = jpegSize(bytes);
    if (jpeg) return new HeadlessImage(bytes, "image/jpeg", jpeg);
    return HeadlessImage.empty();
  }

  static fromPath(path: string) {
    try {
      return HeadlessImage.fromBuffer(readFileSync(path));
    } catch {
      return HeadlessImage.empty();
    }
  }

  static fromDataURL(url: string) {
    const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(
      url,
    );
    return match
      ? HeadlessImage.fromBuffer(Buffer.from(match[1]!, "base64"))
      : HeadlessImage.empty();
  }

  isEmpty() {
    return !this.bytes;
  }
  getSize() {
    return { ...this.size };
  }
  /** Stays the size it was: there is nothing here to scale it with. */
  resize(_options: { width?: number; height?: number; quality?: string }) {
    return this;
  }
  setTemplateImage(_template: boolean) {}
  toPNG() {
    return this.bytes ?? Buffer.alloc(0);
  }
  /** The original bytes; a caller comparing sizes keeps what it had. */
  toJPEG(_quality: number) {
    return this.bytes ?? Buffer.alloc(0);
  }
  toDataURL() {
    return this.bytes
      ? `data:${this.mime};base64,${this.bytes.toString("base64")}`
      : "data:image/png;base64,";
  }
}

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function pngSize(bytes: Buffer) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature))
    return null;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The size in a JPEG's start-of-frame segment. */
export function jpegSize(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at++;
      continue;
    }
    const length = bytes.readUInt16BE(at + 2);
    const frame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (frame)
      return {
        height: bytes.readUInt16BE(at + 5),
        width: bytes.readUInt16BE(at + 7),
      };
    at += 2 + length;
  }
  return null;
}

const compressed = new Map<string, string>();
/** How many recent results are kept: a phone asks again for each size it shows. */
const keep = 24;

/**
 * An image for a phone, whole but smaller: an opaque PNG (a screenshot,
 * mostly) is re-encoded as a JPEG at full size when that saves at least a
 * tenth. Transparent PNGs, JPEGs and anything else go as they were.
 */
export function compressImage(dataUrl: string, quality = 85): string {
  const png = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!png) return dataUrl;
  const key = createHash("sha256").update(dataUrl).digest("base64");
  const known = compressed.get(key);
  if (known) return known;
  let result = dataUrl;
  try {
    const pixels = decodePng(Buffer.from(png[1]!, "base64"));
    if (pixels?.opaque) {
      const jpeg = `data:image/jpeg;base64,${encodeJpeg(pixels.rgba, pixels.width, pixels.height, quality).toString("base64")}`;
      if (jpeg.length < dataUrl.length * 0.9) result = jpeg;
    }
  } catch (e) {
    console.warn("Couldn't compress an image for a phone:", e);
  }
  compressed.set(key, result);
  if (compressed.size > keep)
    compressed.delete(compressed.keys().next().value!);
  return result;
}
