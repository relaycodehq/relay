import { expect, it } from "vitest";
import { parseClock } from "./clockify-format";

const ON = new Date(2026, 9, 13, 9, 12).getTime();
const at = (h: number, m = 0) => new Date(2026, 9, 13, h, m).getTime();

it("reads the ways people type a time", () => {
  expect(parseClock("8:40", ON)).toBe(at(8, 40));
  expect(parseClock("840", ON)).toBe(at(8, 40));
  expect(parseClock("0840", ON)).toBe(at(8, 40));
  expect(parseClock("8.40", ON)).toBe(at(8, 40));
  expect(parseClock(" 8 ", ON)).toBe(at(8));
  expect(parseClock("1240", ON)).toBe(at(12, 40));
  expect(parseClock("8:40 pm", ON)).toBe(at(20, 40));
  expect(parseClock("12am", ON)).toBe(at(0));
  expect(parseClock("12:15 PM", ON)).toBe(at(12, 15));
});

it("rejects what isn't a time", () => {
  for (const text of [
    "",
    "84",
    "8:60",
    "24:00",
    "13pm",
    "8:4",
    "abc",
    "8:40:00",
  ])
    expect(parseClock(text, ON)).toBeUndefined();
});
