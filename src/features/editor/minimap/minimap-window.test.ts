import { describe, expect, it } from "vitest";
import { bandAround, bandHolds, lineAtMinimap, mapLineHeight, minimapWindow } from "./minimap-window";

describe("mapLineHeight", () => {
  it("fits a file on the page, no taller than 2px a line nor denser than legible", () => {
    expect(mapLineHeight(40, 136)).toBe(2);
    expect(mapLineHeight(170, 136)).toBe(0.8);
    expect(mapLineHeight(5000, 136)).toBe(0.6);
  });
});

describe("minimapWindow", () => {
  it("shows a file that fits whole, the slider over the lines on screen", () => {
    const place = minimapWindow({ lines: 100, mapHeight: 600, lineHeight: 2, scrolled: 0.5, topLine: 41, bottomLine: 60 });
    expect(place).toMatchObject({ offset: 0, firstLine: 1, lastLine: 100, sliderTop: 80, sliderHeight: 40 });
  });

  it("scrolls a long file under the map in step with the editor", () => {
    const top = minimapWindow({ lines: 1000, mapHeight: 600, lineHeight: 2, scrolled: 0, topLine: 1, bottomLine: 30 });
    const bottom = minimapWindow({ lines: 1000, mapHeight: 600, lineHeight: 2, scrolled: 1, topLine: 971, bottomLine: 1000 });
    expect([top.firstLine, top.sliderTop]).toEqual([1, 0]);
    expect([bottom.offset, bottom.lastLine, bottom.sliderTop + bottom.sliderHeight]).toEqual([1400, 1000, 600]);
  });

  it("finds the line under a point, within the file", () => {
    expect(lineAtMinimap(9, 1400, 2, 1000)).toBe(705);
    expect(lineAtMinimap(5000, 0, 2, 100)).toBe(100);
  });
});

describe("bandAround", () => {
  it("paints a page either side, within the file", () => {
    expect(bandAround(500, 726, 5000)).toEqual({ first: 273, last: 953 });
    expect(bandAround(1, 227, 300)).toEqual({ first: 1, last: 300 });
  });

  it("is repainted only once the page reaches past it", () => {
    const band = bandAround(500, 726, 5000);
    expect(bandHolds(band, 700, 926)).toBe(true);
    expect(bandHolds(band, 800, 1026)).toBe(false);
  });
});
