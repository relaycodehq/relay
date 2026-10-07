// A baseline JPEG encoder: the standard tables of the JPEG spec (Annex K),
// the AAN forward DCT, and full-resolution colour (4:4:4) so text in
// screenshots keeps its edges. Enough to send screenshots to phones as a
// fraction of their PNG size without a native image library.

/** Position in zigzag order of each coefficient in natural order. */
const zigzag = [
  0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30,
  41, 43, 9, 11, 18, 24, 31, 40, 44, 53, 10, 19, 23, 32, 39, 45, 52, 54, 20, 22,
  33, 38, 46, 51, 55, 60, 21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57,
  58, 62, 63,
];

const lumaQuant = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];
const chromaQuant = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56,
  99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99,
];

// Huffman tables: how many codes of each length 1–16, then the symbols.
const dcLumaCounts = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const dcChromaCounts = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const dcSymbols = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const acLumaCounts = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const acLumaSymbols = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13,
  0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42,
  0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a,
  0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a,
  0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67,
  0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84,
  0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
  0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7,
  0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
  0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];
const acChromaCounts = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const acChromaSymbols = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51,
  0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1,
  0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24,
  0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a,
  0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66,
  0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82,
  0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
  0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa,
  0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9,
  0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4,
  0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

/** Code and length of each symbol, as Annex C builds them from the counts. */
function huffmanCodes(counts: number[], symbols: number[]) {
  const codes: [number, number][] = [];
  let code = 0,
    at = 0;
  for (let length = 1; length <= 16; length++) {
    for (let n = 0; n < counts[length - 1]!; n++)
      codes[symbols[at++]!] = [code++, length];
    code <<= 1;
  }
  return codes;
}
const dcLuma = huffmanCodes(dcLumaCounts, dcSymbols);
const dcChroma = huffmanCodes(dcChromaCounts, dcSymbols);
const acLuma = huffmanCodes(acLumaCounts, acLumaSymbols);
const acChroma = huffmanCodes(acChromaCounts, acChromaSymbols);

/** The AAN DCT's output scale, folded into the quantizers. */
const aanScale = [
  1, 1.387039845, 1.306562965, 1.175875602, 1, 0.785694958, 0.5411961,
  0.275899379,
];

/** The tables at `quality` 1–100: in zigzag order for the file, and as divisors in natural order. */
function quantizers(quality: number) {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const factor = q < 50 ? 5000 / q : 200 - q * 2;
  const table = (base: number[]) => {
    const zz = new Uint8Array(64);
    base.forEach((v, i) => {
      zz[zigzag[i]!] = Math.min(
        255,
        Math.max(1, Math.floor((v * factor + 50) / 100)),
      );
    });
    const divisors = new Float64Array(64);
    for (let row = 0, k = 0; row < 8; row++)
      for (let col = 0; col < 8; col++, k++)
        divisors[k] =
          1 / (zz[zigzag[k]!]! * aanScale[row]! * aanScale[col]! * 8);
    return { zz, divisors };
  };
  return { luma: table(lumaQuant), chroma: table(chromaQuant) };
}

class BitWriter {
  private bytes = new Uint8Array(1 << 16);
  length = 0;
  private current = 0;
  private free = 8;
  byte(value: number) {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = value;
  }
  word(value: number) {
    this.byte(value >> 8);
    this.byte(value & 0xff);
  }
  bits(code: number, length: number) {
    while (length > 0) {
      const take = Math.min(this.free, length);
      length -= take;
      this.current |=
        ((code >> length) & ((1 << take) - 1)) << (this.free - take);
      this.free -= take;
      if (this.free === 0) this.flushByte();
    }
  }
  /** Pads the last byte with ones, as the format asks. */
  align() {
    if (this.free < 8) this.bits((1 << this.free) - 1, this.free);
  }
  private flushByte() {
    this.byte(this.current);
    // A 0xFF in the data is followed by a zero, so it can't read as a marker.
    if (this.current === 0xff) this.byte(0);
    this.current = 0;
    this.free = 8;
  }
  result() {
    return Buffer.from(this.bytes.buffer, 0, this.length);
  }
}

/** The forward DCT of an 8×8 block in place, then quantized into zigzag order. */
function transform(
  block: Float64Array,
  divisors: Float64Array,
  out: Int32Array,
) {
  for (let pass = 0; pass < 2; pass++) {
    // Rows first, then columns: `at` steps along, `by` across.
    const along = pass === 0 ? 8 : 1,
      by = pass === 0 ? 1 : 8;
    for (let i = 0; i < 8; i++) {
      const at = i * along;
      const d0 = block[at]!,
        d1 = block[at + by]!,
        d2 = block[at + 2 * by]!,
        d3 = block[at + 3 * by]!,
        d4 = block[at + 4 * by]!,
        d5 = block[at + 5 * by]!,
        d6 = block[at + 6 * by]!,
        d7 = block[at + 7 * by]!;
      const t0 = d0 + d7,
        t7 = d0 - d7,
        t1 = d1 + d6,
        t6 = d1 - d6,
        t2 = d2 + d5,
        t5 = d2 - d5,
        t3 = d3 + d4,
        t4 = d3 - d4;
      // Even part.
      let t10 = t0 + t3,
        t11 = t1 + t2,
        t12 = t1 - t2;
      const t13 = t0 - t3;
      block[at] = t10 + t11;
      block[at + 4 * by] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      block[at + 2 * by] = t13 + z1;
      block[at + 6 * by] = t13 - z1;
      // Odd part.
      t10 = t4 + t5;
      t11 = t5 + t6;
      t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433,
        z2 = 0.5411961 * t10 + z5,
        z4 = 1.306562965 * t12 + z5,
        z3 = t11 * 0.707106781,
        z11 = t7 + z3,
        z13 = t7 - z3;
      block[at + 5 * by] = z13 + z2;
      block[at + 3 * by] = z13 - z2;
      block[at + by] = z11 + z4;
      block[at + 7 * by] = z11 - z4;
    }
  }
  for (let i = 0; i < 64; i++) {
    const v = block[i]! * divisors[i]!;
    out[zigzag[i]!] = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0;
  }
}

/** Bit count of a coefficient's magnitude, and its bits as JPEG writes them. */
function magnitude(value: number): [number, number] {
  const abs = value < 0 ? -value : value;
  let size = 0;
  while (abs >> size) size++;
  return [value < 0 ? value + (1 << size) - 1 : value, size];
}

/**
 * Encodes RGBA pixels (alpha ignored) as a baseline JPEG at `quality` 1–100.
 */
export function encodeJpeg(
  rgba: Uint8Array,
  width: number,
  height: number,
  quality = 85,
): Buffer {
  const { luma, chroma } = quantizers(quality);
  const w = new BitWriter();
  w.word(0xffd8);
  // JFIF, no thumbnail.
  w.word(0xffe0);
  w.word(16);
  for (const c of [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]) w.byte(c);
  w.word(1);
  w.word(1);
  w.byte(0);
  w.byte(0);
  w.word(0xffdb);
  w.word(132);
  w.byte(0);
  for (const v of luma.zz) w.byte(v);
  w.byte(1);
  for (const v of chroma.zz) w.byte(v);
  // Baseline frame: three components, none subsampled.
  w.word(0xffc0);
  w.word(17);
  w.byte(8);
  w.word(height);
  w.word(width);
  w.byte(3);
  for (const [id, table] of [
    [1, 0],
    [2, 1],
    [3, 1],
  ] as const) {
    w.byte(id);
    w.byte(0x11);
    w.byte(table);
  }
  w.word(0xffc4);
  w.word(418);
  for (const [klass, counts, symbols] of [
    [0x00, dcLumaCounts, dcSymbols],
    [0x10, acLumaCounts, acLumaSymbols],
    [0x01, dcChromaCounts, dcSymbols],
    [0x11, acChromaCounts, acChromaSymbols],
  ] as const) {
    w.byte(klass);
    for (const c of counts) w.byte(c);
    for (const s of symbols) w.byte(s);
  }
  w.word(0xffda);
  w.word(12);
  w.byte(3);
  for (const [id, tables] of [
    [1, 0x00],
    [2, 0x11],
    [3, 0x11],
  ] as const) {
    w.byte(id);
    w.byte(tables);
  }
  w.byte(0);
  w.byte(63);
  w.byte(0);

  const blocks = [
    new Float64Array(64),
    new Float64Array(64),
    new Float64Array(64),
  ];
  const coefficients = new Int32Array(64);
  const previous = [0, 0, 0];
  const component = [
    { quant: luma, dc: dcLuma, ac: acLuma },
    { quant: chroma, dc: dcChroma, ac: acChroma },
    { quant: chroma, dc: dcChroma, ac: acChroma },
  ];
  for (let top = 0; top < height; top += 8)
    for (let left = 0; left < width; left += 8) {
      for (let row = 0, k = 0; row < 8; row++) {
        // Past the edge, the last row and column repeat.
        const y = Math.min(top + row, height - 1);
        for (let col = 0; col < 8; col++, k++) {
          const p = (y * width + Math.min(left + col, width - 1)) * 4;
          const r = rgba[p]!,
            g = rgba[p + 1]!,
            b = rgba[p + 2]!;
          blocks[0]![k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          blocks[1]![k] = -0.16874 * r - 0.33126 * g + 0.5 * b;
          blocks[2]![k] = 0.5 * r - 0.41869 * g - 0.08131 * b;
        }
      }
      for (let c = 0; c < 3; c++) {
        const { quant, dc, ac } = component[c]!;
        transform(blocks[c]!, quant.divisors, coefficients);
        const diff = coefficients[0]! - previous[c]!;
        previous[c] = coefficients[0]!;
        const [bits, size] = magnitude(diff);
        w.bits(...dc[size]!);
        if (size) w.bits(bits, size);
        let last = 63;
        while (last > 0 && coefficients[last] === 0) last--;
        for (let i = 1; i <= last; i++) {
          let zeros = 0;
          while (coefficients[i] === 0) {
            zeros++;
            i++;
          }
          while (zeros >= 16) {
            w.bits(...ac[0xf0]!);
            zeros -= 16;
          }
          const [value, length] = magnitude(coefficients[i]!);
          w.bits(...ac[(zeros << 4) + length]!);
          w.bits(value, length);
        }
        if (last < 63) w.bits(...ac[0x00]!);
      }
    }
  w.align();
  w.word(0xffd9);
  return w.result();
}
