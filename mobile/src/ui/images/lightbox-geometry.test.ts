import { expect, it } from "vitest";
import { imageLimits } from "./lightbox-geometry";

it("centres an unzoomed image and limits panning to its visible edges", () => {
  expect(imageLimits(2, 400, 800, 1)).toEqual({ x: 0, y: 0 });
  expect(imageLimits(2, 400, 800, 3)).toEqual({ x: 400, y: 0 });
  expect(imageLimits(0.5, 400, 800, 2)).toEqual({ x: 200, y: 400 });
});

it("recomputes the fit after unfolding and rotating without a new image load", () => {
  expect(imageLimits(0.5, 400, 800, 3)).toEqual({ x: 400, y: 800 });
  expect(imageLimits(0.5, 800, 800, 3)).toEqual({ x: 200, y: 800 });
  expect(imageLimits(0.5, 800, 400, 3)).toEqual({ x: 0, y: 400 });
});
