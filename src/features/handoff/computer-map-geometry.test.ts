import { describe, expect, it } from "vitest";
import {
  addH,
  mapLayout,
  mapW,
  nodeH,
  nodeW,
  selfW,
} from "./computer-map-geometry";

describe("the computers map layout", () => {
  it("stacks the boxes down the right and centres this computer on them", () => {
    const map = mapLayout([nodeH, nodeH, addH]);
    expect(map.tops).toEqual([22, 96, 170]);
    expect(map.height).toBe(234);
    expect(map.selfY).toBe(117);
    expect(map.x1).toBe(mapW - nodeW);
    expect(map.mid(1)).toBe(96 + nodeH / 2);
    expect(map.mid(2)).toBe(170 + addH / 2);
  });

  it("stays as tall as one computer box when only Add a computer is left", () => {
    const map = mapLayout([addH]);
    expect(map.height).toBe(nodeH + 44);
    expect(map.mid(0)).toBe(22 + addH / 2);
  });

  it("runs each wire from this computer's edge to the box's", () => {
    const map = mapLayout([nodeH, addH]);
    expect(map.wire(map.mid(0))).toMatch(
      new RegExp(`^M ${selfW} ${map.selfY} C .* ${map.x1} ${map.mid(0)}$`),
    );
    expect(map.at(map.mid(0), 0)).toEqual({ x: selfW, y: map.selfY });
    expect(map.at(map.mid(0), 1)).toEqual({ x: map.x1, y: map.mid(0) });
  });

  it("puts the halfway point midway, where a lone thread's dot goes", () => {
    const map = mapLayout([nodeH, addH]);
    const to = map.mid(0);
    const p = map.at(to, 0.5);
    expect(p.x).toBeCloseTo((selfW + map.x1) / 2);
    expect(p.y).toBeCloseTo((map.selfY + to) / 2);
  });
});
