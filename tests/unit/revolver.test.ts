import { describe, expect, it } from "vitest";
import {
  chambersReached,
  foldAngle,
  restingCylinder,
  turnCylinder,
} from "../../src/lib/revolver";

const chambers = 6;
const at = (rot: number) => (((-rot / 60) % 6) + 6) % 6;

describe("turnCylinder", () => {
  it("turns a chamber a step, either way", () => {
    const start = restingCylinder(2, true, chambers);
    const next = turnCylinder(start, 3, true, 1, chambers);
    expect(next.rot - start.rot).toBe(-60);
    expect(next.motion).toBe("step");
    expect(turnCylinder(next, 2, true, -1, chambers).rot).toBe(start.rot);
  });
  it("overspins on past the last preset and lands on the first", () => {
    const last = restingCylinder(5, true, chambers);
    const wrapped = turnCylinder(last, 0, true, 1, chambers);
    expect(wrapped.motion).toBe("overspin");
    // Onward, never back: a chamber plus two whole turns.
    expect(wrapped.rot - last.rot).toBe(-60 - 720);
    expect(at(wrapped.rot)).toBe(0);
  });
  it("overspins backwards from the first to the last", () => {
    const first = restingCylinder(0, true, chambers);
    const wrapped = turnCylinder(first, 5, true, -1, chambers);
    expect(wrapped.rot - first.rot).toBe(60 + 720);
    expect(at(wrapped.rot)).toBe(5);
  });
  it("passes empty chambers when fewer presets than chambers wrap", () => {
    // Four presets in six chambers: from the 4th on to the 1st passes two empties.
    const last = restingCylinder(3, true, chambers);
    expect(turnCylinder(last, 0, true, 1, chambers).rot - last.rot).toBe(-180 - 720);
  });
  it("spins a whole turn as it opens", () => {
    const closed = restingCylinder(1, false, chambers);
    const opened = turnCylinder(closed, 2, true, 1, chambers);
    expect(opened.motion).toBe("spin");
    expect(opened.rot - closed.rot).toBe(-60 - 360);
  });
});

describe("chambersReached", () => {
  it("counts every chamber passed, even several in one frame", () => {
    expect(chambersReached(3, 5.4, 1)).toEqual({ last: 5, count: 2 });
    expect(chambersReached(3, -0.2, -1)).toEqual({ last: 0, count: 3 });
  });
  it("doesn't click again on the bounce back past the stop", () => {
    const over = chambersReached(3, 4.05, 1);
    expect(over).toEqual({ last: 4, count: 1 });
    expect(chambersReached(over.last, 3.97, 1)).toEqual({ last: 4, count: 0 });
    expect(chambersReached(over.last, 4, 1)).toEqual({ last: 4, count: 0 });
  });
});

describe("foldAngle", () => {
  it("folds into -180–180 so frame-to-frame turns unwrap", () => {
    expect(foldAngle(350)).toBe(-10);
    expect(foldAngle(-190)).toBe(170);
    expect(foldAngle(45)).toBe(45);
  });
});
