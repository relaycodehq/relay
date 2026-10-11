import { describe, expect, it } from "vitest";
import { dragOffset } from "./useDragSort";

const box = (top: number, height: number) => ({
  top,
  height,
  bottom: top + height,
});

describe("dragOffset", () => {
  // The desktop queue the bug was found in: a 97.5 px message over a 47 px one.
  const rows = [box(0, 97.5), box(103.5, 47.1)];
  const middle = (b: ReturnType<typeof box>) => b.top + b.height / 2;

  it("lets a tall row's middle pass a shorter last row's", () => {
    const d = dragOffset(rows, 0, 500);
    expect(middle(rows[0]!) + d).toBeGreaterThan(middle(rows[1]!));
  });

  it("lets a tall last row's middle pass a shorter first row's", () => {
    const flipped = [box(0, 47.1), box(53.1, 97.5)];
    const d = dragOffset(flipped, 1, -500);
    expect(middle(flipped[1]!) + d).toBeLessThan(middle(flipped[0]!));
  });

  it("follows the pointer between the ends", () => {
    expect(dragOffset(rows, 0, 20)).toBe(20);
  });
});
