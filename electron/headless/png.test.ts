import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { compressImage } from "./image";
import { encodeJpeg } from "./jpeg";
import { decodePng } from "./png";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Buffer) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (name: string, body: Buffer) => {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(name, 4, "latin1");
  body.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
};

/**
 * A PNG of raw scanlines (already packed for `depth`), each row filtered
 * with the next of PNG's five filters, so decoding has to undo every one.
 */
function png(
  width: number,
  height: number,
  depth: number,
  type: number,
  rows: Buffer[],
  extra: Buffer[] = [],
) {
  const bpp = Math.max(
    1,
    (depth * { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]!) >> 3,
  );
  const filtered = rows.map((row, y) => {
    const filter = y % 5,
      above = rows[y - 1];
    const out = Buffer.alloc(row.length + 1);
    out[0] = filter;
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? row[x - bpp]! : 0,
        b = above ? above[x]! : 0,
        c = above && x >= bpp ? above[x - bpp]! : 0;
      const p = a + b - c,
        paeth =
          Math.abs(p - a) <= Math.abs(p - b) &&
          Math.abs(p - a) <= Math.abs(p - c)
            ? a
            : Math.abs(p - b) <= Math.abs(p - c)
              ? b
              : c;
      const predict = [0, a, b, (a + b) >> 1, paeth][filter]!;
      out[x + 1] = (row[x]! - predict) & 0xff;
    }
    return out;
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = type;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...extra,
    chunk("IDAT", deflateSync(Buffer.concat(filtered))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A colourful test card: gradients, an edge and some noise. */
function card(width: number, height: number) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      rgb[i] = (x * 255) / (width - 1);
      rgb[i + 1] = (y * 255) / (height - 1);
      rgb[i + 2] = x > width / 2 ? 200 : ((x * y) % 7) * 20;
    }
  return rgb;
}

it("reads PNGs through every filter, colour type and bit depth it meets", () => {
  const width = 13,
    height = 11,
    rgb = card(width, height);
  const rows = (bytes: Buffer, stride: number) =>
    Array.from({ length: height }, (_, y) =>
      bytes.subarray(y * stride, (y + 1) * stride),
    );

  const truecolor = decodePng(png(width, height, 8, 2, rows(rgb, width * 3)))!;
  expect(truecolor.opaque).toBe(true);
  for (let p = 0; p < width * height; p++)
    expect([...truecolor.rgba.subarray(p * 4, p * 4 + 4)]).toEqual([
      rgb[p * 3],
      rgb[p * 3 + 1],
      rgb[p * 3 + 2],
      255,
    ]);

  // 16-bit RGBA keeps the high byte, and a see-through pixel makes it not opaque.
  const rgba16 = Buffer.alloc(width * height * 8);
  for (let p = 0; p < width * height; p++) {
    for (let c = 0; c < 3; c++)
      rgba16.writeUInt16BE(rgb[p * 3 + c]! * 257, p * 8 + c * 2);
    rgba16.writeUInt16BE(p === 5 ? 0 : 65535, p * 8 + 6);
  }
  const deep = decodePng(png(width, height, 16, 6, rows(rgba16, width * 8)))!;
  expect(deep.opaque).toBe(false);
  expect([...deep.rgba.subarray(0, 4)]).toEqual([rgb[0], rgb[1], rgb[2], 255]);
  expect(deep.rgba[5 * 4 + 3]).toBe(0);

  // A 2-bit palette with one see-through entry.
  const palette = chunk(
    "PLTE",
    Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]),
  );
  const transparency = chunk("tRNS", Buffer.from([255, 255, 0]));
  const stride = Math.ceil((width * 2) / 8);
  const indexed = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      indexed[y * stride + (x >> 2)]! |= ((x + y) % 4) << (6 - (x % 4) * 2);
  const paletted = decodePng(
    png(width, height, 2, 3, rows(indexed, stride), [palette, transparency]),
  )!;
  expect([...paletted.rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  expect([...paletted.rgba.subarray(4, 8)]).toEqual([0, 255, 0, 255]);
  expect(paletted.rgba[2 * 4 + 3]).toBe(0);
  expect([...paletted.rgba.subarray(12, 16)]).toEqual([9, 9, 9, 255]);

  // 4-bit grey scales up to the full range.
  const grey = Buffer.alloc(Math.ceil(width / 2) * height, 0xf0);
  const greys = decodePng(
    png(width, height, 4, 0, rows(grey, Math.ceil(width / 2))),
  )!;
  expect([...greys.rgba.subarray(0, 8)]).toEqual([
    255, 255, 255, 255, 0, 0, 0, 255,
  ]);

  expect(decodePng(Buffer.from("not a png"))).toBeNull();
});

it("sends opaque PNGs whole as JPEGs where they come out smaller, and leaves the rest", async () => {
  const width = 320,
    height = 200,
    rgb = card(width, height);
  const source = png(
    width,
    height,
    8,
    2,
    Array.from({ length: height }, (_, y) =>
      rgb.subarray(y * width * 3, (y + 1) * width * 3),
    ),
  );
  const url = `data:image/png;base64,${source.toString("base64")}`;
  const sent = compressImage(url);
  expect(sent.startsWith("data:image/jpeg;base64,")).toBe(true);
  const jpeg = Buffer.from(sent.split(",")[1]!, "base64");
  expect(jpeg.length).toBeLessThan(source.length * 0.9);
  // Baseline, at full size: SOF0 says 320 × 200.
  const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  expect(jpeg.readUInt16BE(sof + 5)).toBe(height);
  expect(jpeg.readUInt16BE(sof + 7)).toBe(width);
  expect([...jpeg.subarray(-2)]).toEqual([0xff, 0xd9]);

  // macOS can decode it: close to the original, pixel for pixel.
  if (process.platform === "darwin") {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-jpeg-")));
    try {
      await writeFile(
        join(dir, "card.jpg"),
        encodeJpeg(decodePng(source)!.rgba, width, height, 85),
      );
      execFileSync(
        "sips",
        [
          "-s",
          "format",
          "png",
          join(dir, "card.jpg"),
          "--out",
          join(dir, "back.png"),
        ],
        {
          stdio: "ignore",
        },
      );
      const back = decodePng(await readFile(join(dir, "back.png")))!;
      expect([back.width, back.height]).toEqual([width, height]);
      let error = 0;
      for (let p = 0; p < width * height; p++)
        for (let c = 0; c < 3; c++)
          error += Math.abs(back.rgba[p * 4 + c]! - rgb[p * 3 + c]!);
      expect(error / (width * height * 3)).toBeLessThan(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // JPEGs and other images go as they are.
  const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  expect(compressImage(photo)).toBe(photo);
  expect(compressImage("data:image/gif;base64,R0lGODlh")).toBe(
    "data:image/gif;base64,R0lGODlh",
  );
});

it("rejects a tiny PNG whose compressed scanlines expand past its declared size", () => {
  const bytes = png(1, 1, 8, 2, [Buffer.alloc(1024 * 1024)]);
  expect(bytes.length).toBeLessThan(2000);
  expect(decodePng(bytes)).toBeNull();
});

it("preserves PNGs outside JPEG's dimension range", () => {
  const row = Buffer.alloc(65536 * 3);
  let seed = 42;
  for (let i = 0; i < row.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    row[i] = seed >>> 24;
  }
  const original = `data:image/png;base64,${png(65536, 1, 8, 2, [row]).toString("base64")}`;
  expect(compressImage(original)).toBe(original);
  expect(() => encodeJpeg(new Uint8Array(4), 1, 65536)).toThrow(
    "JPEG dimensions",
  );
});
