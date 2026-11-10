import { expect, it } from "vitest";
import { atThreadEnd, railPlace, RUN_OUT } from "./rail-scrub";

it("holds the first prompt above the first tick", () => {
  expect(railPlace(-30, 9, 5)).toEqual({ turn: 0, through: 0 });
});

it("runs through a turn between its tick and the next", () => {
  const place = railPlace(9 * 2 + 3, 9, 5);
  expect(place.turn).toBe(2);
  expect(place.through).toBeCloseTo(3 / 9);
});

it("runs on past the last tick through the last turn to the thread's end", () => {
  const lastTick = 9 * 4;
  expect(railPlace(lastTick + RUN_OUT / 2, 9, 5)).toEqual({
    turn: 4,
    through: 4 / 9,
  });
  const end = railPlace(lastTick + 500, 9, 5);
  expect(end).toEqual({ turn: 4, through: 1 });
  expect(atThreadEnd(end, 5)).toBe(true);
});

it("gives the last turn room to drag through when ticks run together", () => {
  const lastTick = 0.5 * 999;
  expect(railPlace(lastTick + RUN_OUT / 2, 0.5, 1000)).toEqual({
    turn: 999,
    through: 0.5,
  });
});
