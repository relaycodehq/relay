import { describe, expect, it } from "vitest";
import {
  clampView,
  fitScale,
  stepScale,
  zoomTo,
} from "./image-zoom";

const stage = { width: 1000, height: 800 };
const screenshot = { width: 2880, height: 1800 };

describe("image viewer zoom", () => {
  it("fits a large image inside the margin but never enlarges a small one", () => {
    expect(fitScale(screenshot, stage)).toBeCloseTo(952 / 2880);
    expect(fitScale({ width: 64, height: 64 }, stage)).toBe(1);
  });

  it("keeps the image point under the pointer in place", () => {
    const fit = fitScale(screenshot, stage);
    const at = { x: 200, y: -150 };
    const before = { scale: fit, x: 0, y: 0 };
    const after = zoomTo(before, 1, at, screenshot, stage);
    // The image-space point under `at` is the same before and after.
    expect((at.x - after.x) / after.scale).toBeCloseTo(
      (at.x - before.x) / before.scale,
    );
    expect((at.y - after.y) / after.scale).toBeCloseTo(
      (at.y - before.y) / before.scale,
    );
  });

  it("stops zooming out at the fitted size, centred", () => {
    const zoomed = { scale: 1, x: 400, y: 300 };
    expect(zoomTo(zoomed, 0.01, { x: 0, y: 0 }, screenshot, stage)).toEqual({
      scale: fitScale(screenshot, stage),
      x: 0,
      y: 0,
    });
  });

  it("can't drag a zoomed image's edge past the stage's", () => {
    const view = clampView({ scale: 1, x: 5000, y: -5000 }, screenshot, stage);
    expect(view).toEqual({
      scale: 1,
      x: (2880 - 1000) / 2,
      y: -(1800 - 800) / 2,
    });
  });

  it("steps through round zoom levels", () => {
    expect(stepScale(0.33, 1)).toBe(0.5);
    expect(stepScale(1, 1)).toBe(1.5);
    expect(stepScale(1, -1)).toBe(0.75);
  });
});
