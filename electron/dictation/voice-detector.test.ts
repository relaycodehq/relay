import { expect, it } from "vitest";
import { LevelGain, SpeechGate } from "./voice-detector";

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

const tone = (level: number) =>
  Float32Array.from({ length: 512 }, (_, i) => level * Math.SQRT2 * Math.sin(i / 3));
const rms = (w: Float32Array) =>
  Math.sqrt(w.reduce((sum, v) => sum + v * v, 0) / w.length);

it("lifts a whisper to where the detector hears it, but not the hush between words", () => {
  const gain = new LevelGain();
  // Words and pauses: a whisper at -64 dBFS comes up to about -30.
  const word = 10 ** (-64 / 20),
    pause = 10 ** (-80 / 20);
  let out: Float32Array = tone(word);
  for (let i = 0; i < 40; i++) {
    const loud = i % 8 < 5;
    const next = gain.apply(tone(loud ? word : pause));
    if (loud) out = next;
  }
  expect(20 * Math.log10(rms(out))).toBeCloseTo(-30, 0);
  // Silence after it gets the whisper's gain, not one of its own.
  const hush = gain.apply(tone(10 ** (-90 / 20)));
  expect(20 * Math.log10(rms(hush))).toBeLessThan(-50);
});

it("doesn't lift steady room noise into what the detector takes for a voice", () => {
  const gain = new LevelGain();
  let out: Float32Array = tone(10 ** (-60 / 20));
  for (let i = 0; i < 200; i++) out = gain.apply(tone(10 ** (-60 / 20)));
  expect(20 * Math.log10(rms(out))).toBeLessThanOrEqual(-39);
});

it("lifts a whisper that starts after a quiet room", () => {
  const gain = new LevelGain();
  for (let i = 0; i < 100; i++) gain.apply(tone(10 ** (-70 / 20)));
  let out: Float32Array = tone(0);
  for (let i = 0; i < 30; i++) out = gain.apply(tone(10 ** (-60 / 20)));
  expect(20 * Math.log10(rms(out))).toBeGreaterThan(-35);
});

it("never turns loud speech down or touches it", () => {
  const gain = new LevelGain();
  const loud = tone(0.3);
  expect(gain.apply(loud)).toBe(loud);
});
