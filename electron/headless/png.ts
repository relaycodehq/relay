import { inflateSync } from "node:zlib";

export interface Pixels {
  width: number;
  height: number;
  /** 8-bit RGBA, row by row. */
  rgba: Uint8Array;
  /** No pixel is at all see-through. */
  opaque: boolean;
}

/** Past this, decoding isn't worth the memory; the image goes as it was. */
const maxPixels = 40_000_000;

/**
 * Reads a PNG into RGBA: every colour type and bit depth, without
 * interlacing (which screenshots never use). Null for what it can't read.
 */
export function decodePng(bytes: Buffer): Pixels | null {
  if (
    bytes.length < 33 ||
    bytes.readUInt32BE(0) !== 0x89504e47 ||
    bytes.readUInt32BE(4) !== 0x0d0a1a0a
  )
    return null;
  let width = 0,
    height = 0,
    depth = 0,
    type = -1,
    interlaced = false;
  let palette: Buffer | undefined, transparency: Buffer | undefined;
  const data: Buffer[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at),
      name = bytes.toString("latin1", at + 4, at + 8),
      body = bytes.subarray(at + 8, at + 8 + length);
    if (name === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      type = body[9]!;
      interlaced = body[12] !== 0;
    } else if (name === "PLTE") palette = body;
    else if (name === "tRNS") transparency = body;
    else if (name === "IDAT") data.push(body);
    else if (name === "IEND") break;
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (
    !channels ||
    interlaced ||
    !width ||
    !height ||
    width * height > maxPixels ||
    ![1, 2, 4, 8, 16].includes(depth) ||
    (type === 3 && !palette)
  )
    return null;
  const bits = channels * depth,
    stride = Math.ceil((width * bits) / 8),
    step = Math.max(1, bits >> 3);
  const expected = (stride + 1) * height;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  } catch {
    return null;
  }
  if (raw.length !== expected) return null;

  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!,
      line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      out = y * stride,
      up = out - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= step ? rows[out + x - step]! : 0,
        above = y > 0 ? rows[up + x]! : 0,
        corner = y > 0 && x >= step ? rows[up + x - step]! : 0;
      let value = line[x]!;
      if (filter === 1) value += left;
      else if (filter === 2) value += above;
      else if (filter === 3) value += (left + above) >> 1;
      else if (filter === 4) value += paeth(left, above, corner);
      else if (filter !== 0) return null;
      rows[out + x] = value & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  const max = (1 << depth) - 1;
  /** Sample `i` of row `y`, as 8 bits. */
  const sample = (y: number, i: number) => {
    if (depth === 8) return rows[y * stride + i]!;
    if (depth === 16) return rows[y * stride + i * 2]!;
    const bit = i * depth,
      byte = rows[y * stride + (bit >> 3)]!;
    return (byte >> (8 - depth - (bit & 7))) & max;
  };
  /** The full 16 or fewer bits, which tRNS names its colour in. */
  const exact = (y: number, i: number) =>
    depth === 16 ? rows.readUInt16BE(y * stride + i * 2) : sample(y, i);
  const scale = (v: number) => (depth >= 8 ? v : Math.round((v * 255) / max));
  let opaque = true;
  for (let y = 0, o = 0; y < height; y++)
    for (let x = 0; x < width; x++, o += 4) {
      let r: number,
        g: number,
        b: number,
        a = 255;
      if (type === 3) {
        const index = sample(y, x);
        r = palette![index * 3] ?? 0;
        g = palette![index * 3 + 1] ?? 0;
        b = palette![index * 3 + 2] ?? 0;
        if (transparency && index < transparency.length)
          a = transparency[index]!;
      } else if (type === 0 || type === 4) {
        r = g = b = scale(sample(y, x * channels));
        if (type === 4) a = scale(sample(y, x * 2 + 1));
        else if (transparency && exact(y, x) === transparency.readUInt16BE(0))
          a = 0;
      } else {
        r = sample(y, x * channels);
        g = sample(y, x * channels + 1);
        b = sample(y, x * channels + 2);
        if (type === 6) a = sample(y, x * 4 + 3);
        else if (
          transparency &&
          exact(y, x * 3) === transparency.readUInt16BE(0) &&
          exact(y, x * 3 + 1) === transparency.readUInt16BE(2) &&
          exact(y, x * 3 + 2) === transparency.readUInt16BE(4)
        )
          a = 0;
      }
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
      if (a !== 255) opaque = false;
    }
  return { width, height, rgba, opaque };
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
