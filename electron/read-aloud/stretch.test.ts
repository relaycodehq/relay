import { describe, expect, it } from "vitest";
import { Stretch } from "./stretch";

const rate = 24000;

function tone(seconds: number, hz = 440) {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return out;
}

function stretched(speed: number, input: Float32Array, pieces: number[]) {
  const s = new Stretch(speed, rate);
  const parts: Float32Array[] = [];
  let at = 0;
  for (let i = 0; at < input.length; i++) {
    const n = pieces[i % pieces.length];
    parts.push(s.push(input.subarray(at, at + n)));
    at += n;
  }
  parts.push(s.flush());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Hz, from zero crossings in the middle of the clip. */
function pitch(pcm: Float32Array) {
  const from = Math.floor(pcm.length * 0.2);
  const to = Math.floor(pcm.length * 0.8);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) {
    if (pcm[i - 1] < 0 !== pcm[i] < 0) crossings++;
  }
  return crossings / 2 / ((to - from) / rate);
}

describe("Stretch", () => {
  it.each([0.75, 1.5, 2])(
    "changes the length by %sx but keeps the pitch and the level",
    (speed) => {
      const input = tone(1);
      const out = stretched(speed, input, [4800]);
      expect(out.length).toBe(Math.round(input.length / speed));
      expect(pitch(out)).toBeCloseTo(440, -1);
      // A badly lined-up frame cancels against its neighbour and leaves a dip.
      const win = rate / 100;
      for (let at = win * 2; at + win < out.length - win * 2; at += win) {
        let sq = 0;
        for (let i = at; i < at + win; i++) sq += out[i] * out[i];
        expect(Math.sqrt(sq / win)).toBeGreaterThan(0.3);
      }
    },
  );

  it("gives the same audio however the stream is cut", () => {
    const input = tone(0.5, 220);
    const whole = stretched(1.25, input, [input.length]);
    const bits = stretched(1.25, input, [1, 137, 2048, 11, 600]);
    expect(Array.from(bits)).toEqual(Array.from(whole));
  });

  it("passes audio straight through at 1x", () => {
    const input = tone(0.1);
    const s = new Stretch(1, rate);
    expect(s.push(input)).toBe(input);
    expect(s.flush().length).toBe(0);
  });
});
