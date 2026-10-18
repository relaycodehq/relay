import { expect, it } from "vitest";
import { SpeechGate } from "./voice-detector";

// Each step is one 32 ms window, counted from the end of the first.
const run = (gate: SpeechGate, probability: number, windows: number) =>
  Array.from({ length: windows }, () => gate.step(probability)).at(-1);

it("hears speech after 0.2 s of it and lets it go after 0.3 s of quiet", () => {
  const gate = new SpeechGate();
  expect(run(gate, 0.9, 7)).toBe(false);
  expect(run(gate, 0.9, 1)).toBe(true);
  // A breath between words, and a softer stretch, don't end it.
  expect(run(gate, 0.1, 5)).toBe(true);
  expect(run(gate, 0.3, 40)).toBe(true);
  expect(run(gate, 0.9, 1)).toBe(true);
  expect(run(gate, 0.1, 10)).toBe(true);
  expect(run(gate, 0.1, 1)).toBe(false);
  // A click is not speech.
  expect(run(gate, 0.9, 2)).toBe(false);
  expect(run(gate, 0.1, 1)).toBe(false);
  expect(run(gate, 0.9, 7)).toBe(false);
});
