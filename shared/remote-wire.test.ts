import { expect, it } from "vitest";
import { frameFits, maxFrameBytes } from "./remote-wire";

it("allows ten full-size screenshot data URLs within the bridge budget", () => {
  const json = JSON.stringify({
    images: Array.from({ length: 10 }, () => ({
      dataUrl: "A".repeat(1_100_000),
    })),
  });
  expect(frameFits(json, true)).toBe(true);
  expect(frameFits(json, false)).toBe(true);
});

it("accounts for encryption, the compact flag, UTF-8, and legacy base64 expansion", () => {
  expect(frameFits("A".repeat(maxFrameBytes - 17), true)).toBe(true);
  expect(frameFits("A".repeat(maxFrameBytes - 16), true)).toBe(false);
  expect(frameFits("A".repeat(25 * 1024 * 1024), false)).toBe(false);
  expect(frameFits("é".repeat(maxFrameBytes / 2), true)).toBe(false);
});
