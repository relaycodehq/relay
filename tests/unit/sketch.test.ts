import { describe, expect, it } from "vitest";
import {
  blurShape,
  recognizeShape,
  snapLine,
  type Point,
} from "../../src/lib/sketch";

const circle = (cx: number, cy: number, r: number): Point[] =>
  Array.from({ length: 80 }, (_, i) => {
    const a = (i / 79) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
const edge = (a: Point, b: Point): Point[] =>
  Array.from({ length: 20 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / 20,
    y: a.y + ((b.y - a.y) * i) / 20,
  }));

describe("sketch shape snapping", () => {
  it("snaps a nearly level line to exactly level", () => {
    const [a, b] = snapLine({ x: 0, y: 0 }, { x: 100, y: 4 });
    expect(a).toEqual({ x: 0, y: 0 });
    expect(b.y).toBeCloseTo(0);
    expect(b.x).toBeCloseTo(Math.hypot(100, 4));
  });

  it("turns a wobbly straight stroke into a line", () => {
    const stroke = edge({ x: 10, y: 10 }, { x: 200, y: 12 }).map((p, i) => ({
      ...p,
      y: p.y + (i % 2 ? 1.5 : -1.5),
    }));
    const shape = recognizeShape(stroke);
    expect(shape).toMatchObject({ kind: "polyline", closed: false });
    expect(shape?.kind === "polyline" && shape.points).toHaveLength(2);
  });

  it("recognizes a round loop as a circle", () => {
    const shape = recognizeShape(circle(100, 100, 50));
    expect(shape?.kind).toBe("ellipse");
    if (shape?.kind !== "ellipse") return;
    expect(shape.rx).toBeCloseTo(shape.ry);
    expect(shape.center.x).toBeCloseTo(100, 0);
  });

  it("recognizes a closed four-cornered loop as an upright box", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 160, y: 4 },
      { x: 158, y: 100 },
      { x: 2, y: 96 },
    ];
    const stroke = corners.flatMap((c, i) => edge(c, corners[(i + 1) % 4]));
    const shape = recognizeShape([...stroke, corners[0]]);
    expect(shape).toMatchObject({ kind: "polyline", closed: true });
    if (shape?.kind !== "polyline") return;
    expect(shape.points).toHaveLength(4);
    expect(shape.points[0].y).toBeCloseTo(shape.points[1].y);
    expect(shape.points[1].x).toBeCloseTo(shape.points[2].x);
  });

  it("ignores tiny scribbles", () => {
    expect(
      recognizeShape([
        { x: 0, y: 0 },
        { x: 3, y: 2 },
      ]),
    ).toBeUndefined();
  });
});

describe("blur shapes", () => {
  it("turns a rotated ellipse into the upright box around it", () => {
    const shape = blurShape({
      kind: "ellipse",
      center: { x: 100, y: 50 },
      rx: 40,
      ry: 10,
      angle: Math.PI / 2,
    });
    expect(shape.kind === "polyline" && shape.closed).toBe(true);
    const [topLeft, , bottomRight] =
      shape.kind === "polyline" ? shape.points : [];
    expect(topLeft.x).toBeCloseTo(90);
    expect(topLeft.y).toBeCloseTo(10);
    expect(bottomRight.x).toBeCloseTo(110);
    expect(bottomRight.y).toBeCloseTo(90);
  });

  it("leaves lines alone", () => {
    const line = {
      kind: "polyline" as const,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      closed: false,
    };
    expect(blurShape(line)).toBe(line);
  });
});
