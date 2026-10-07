import { expect, it } from "vitest";
import { HeadlessImage, jpegSize, pngSize } from "./image";

/** A PNG's signature and IHDR, which is all its size needs. */
const png = (width: number, height: number) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};
/** A JPEG with an APP0 segment before its baseline frame header. */
const jpeg = (width: number, height: number) =>
  Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    0x01,
    0x01,
    0x11,
    0x00,
  ]);

it("reads PNG and JPEG sizes and nothing else", () => {
  expect(pngSize(png(640, 480))).toEqual({ width: 640, height: 480 });
  expect(jpegSize(jpeg(1024, 768))).toEqual({ width: 1024, height: 768 });
  expect(pngSize(jpeg(1, 1))).toBeNull();
  expect(jpegSize(Buffer.from("GIF89a"))).toBeNull();
});

it("hands images on whole, so a caller comparing sizes keeps the original", () => {
  const url = `data:image/jpeg;base64,${jpeg(4000, 3000).toString("base64")}`;
  const image = HeadlessImage.fromDataURL(url);
  expect(image.isEmpty()).toBe(false);
  expect(image.getSize()).toEqual({ width: 4000, height: 3000 });
  const small = image.resize({ width: 200 });
  expect(`data:image/jpeg;base64,${small.toJPEG(82).toString("base64")}`).toBe(
    url,
  );
  expect(
    HeadlessImage.fromDataURL("data:image/svg+xml;base64,PHN2Zz4=").isEmpty(),
  ).toBe(true);
  expect(HeadlessImage.fromPath("/no/such/icon.png").isEmpty()).toBe(true);
});
