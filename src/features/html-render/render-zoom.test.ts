import { describe, expect, it } from "vitest";
import { fitZoom, stepZoom } from "./render-zoom";

describe("fitZoom", () => {
  it("grows a short page until it meets the stage's width or height", () => {
    expect(
      fitZoom({ width: 800, height: 300 }, { width: 1600, height: 900 }),
    ).toBe(2);
    expect(
      fitZoom({ width: 800, height: 600 }, { width: 1600, height: 900 }),
    ).toBe(1.5);
  });
  it("keeps a page taller than the stage at its own size, to scroll", () => {
    expect(
      fitZoom({ width: 800, height: 3000 }, { width: 1600, height: 900 }),
    ).toBe(1);
  });
  it("shrinks only a page wider than the stage", () => {
    expect(
      fitZoom({ width: 1000, height: 3000 }, { width: 800, height: 900 }),
    ).toBe(0.8);
  });
});

describe("stepZoom", () => {
  it("steps from an in-between fit to the next stop either way", () => {
    expect(stepZoom(1.39, 1)).toBe(1.5);
    expect(stepZoom(1.39, -1)).toBe(1.25);
    expect(stepZoom(4, 1)).toBe(4);
  });
});
