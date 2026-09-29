import { it, expect } from "vitest";
import {
  joinText,
  quietest,
  Transcriber,
  type SpeechEngine,
} from "../../electron/dictation/transcriber";

const rate = 16000;

/**
 * Speech is any sample above 0.5. Each decode answers with one word per 0.1 s
 * of speech it was given, named after the sample value, so tests can tell
 * which audio reached which decode.
 */
function fakeEngine() {
  const decoded: Float32Array[] = [];
  const engine: SpeechEngine = {
    async decode(samples) {
      decoded.push(samples);
      const words: string[] = [];
      for (let at = 0; at + rate / 10 <= samples.length; at += rate / 10) {
        const value = samples[at];
        if (value > 0.5) words.push(`w${Math.round(value * 10)}`);
      }
      return words.join(" ");
    },
    detect: (samples) => samples.some((s) => s > 0.5),
    resetDetector() {},
  };
  return { engine, decoded };
}

function lastSpeech(samples: Float32Array) {
  let at = samples.length - 1;
  while (at >= 0 && samples[at] <= 0.5) at--;
  return at;
}

const chunk = (seconds: number, value: number) =>
  new Float32Array(Math.round(seconds * rate)).fill(value);

it("keeps the audio from just before speech was detected", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {});
  transcriber.push(chunk(1, 0));
  transcriber.push(chunk(0.2, 0.3)); // a soft first syllable the detector missed
  transcriber.push(chunk(0.5, 0.9));
  await transcriber.stop();
  expect(decoded[0].some((s) => Math.abs(s - 0.3) < 1e-6)).toBe(true);
});

it("keeps a word that starts before the detector noticed the pause", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {});
  transcriber.push(chunk(0.5, 0.9));
  // The chunk that closes the phrase already holds the next word's onset.
  transcriber.push(new Float32Array([...chunk(0.2, 0), ...chunk(0.1, 0.3)]));
  transcriber.push(chunk(0.5, 0.8));
  await transcriber.stop();
  const next = decoded.find((d) => d.some((s) => Math.abs(s - 0.8) < 1e-6))!;
  expect(next.some((s) => Math.abs(s - 0.3) < 1e-6)).toBe(true);
});

it("keeps talking through a pause to think in one phrase", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {});
  transcriber.push(chunk(0.5, 0.9));
  transcriber.push(chunk(1.2, 0));
  transcriber.push(chunk(0.5, 0.8));
  await transcriber.stop();
  const last = decoded.at(-1)!;
  expect(last.some((s) => Math.abs(s - 0.9) < 1e-6)).toBe(true);
  expect(last.some((s) => Math.abs(s - 0.8) < 1e-6)).toBe(true);
});

it("stops decoding again while nothing is said", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {});
  transcriber.push(chunk(0.5, 0.9));
  await new Promise((resolve) => setTimeout(resolve));
  const before = decoded.length;
  for (let tenth = 0; tenth < 15; tenth++) {
    transcriber.push(chunk(0.1, 0));
    await new Promise((resolve) => setTimeout(resolve));
  }
  // One to hear the end of the last word, then quiet.
  expect(decoded.length - before).toBeLessThanOrEqual(1);
  await transcriber.stop();
});

it("settles phrases in order and only ever grows the settled text", async () => {
  const { engine } = fakeEngine();
  const seen: string[] = [];
  const transcriber = new Transcriber(engine, (settled) => seen.push(settled), {
    pause: 0.3,
  });
  for (const value of [0.7, 0, 0.8, 0, 0.9]) {
    transcriber.push(chunk(0.4, value));
    await new Promise((resolve) => setTimeout(resolve));
  }
  const text = await transcriber.stop();
  expect(text).toBe("w7 w7 w7 w7 w8 w8 w8 w8 w9 w9 w9 w9");
  for (let i = 1; i < seen.length; i++)
    expect(seen[i].startsWith(seen[i - 1])).toBe(true);
});

it("splits a phrase with no pause at its quietest moment", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {}, { maxPhrase: 3 });
  // Barely speech from 2.5 s to 2.6 s: the breath between two words.
  for (let tenth = 0; tenth < 40; tenth++)
    transcriber.push(chunk(0.1, tenth === 25 ? 0.51 : 0.9));
  await transcriber.stop();
  const ends = decoded.map((d) => lastSpeech(d) / rate);
  expect(ends.some((end) => end > 2.5 && end < 2.6)).toBe(true);
});

it("ends a phrase that runs out of room in a pause instead of splitting it", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {}, { maxPhrase: 1 });
  transcriber.push(chunk(0.8, 0.9));
  for (let tenth = 0; tenth < 10; tenth++) transcriber.push(chunk(0.1, 0));
  await transcriber.stop();
  // A clip of only silence is where Parakeet makes words up.
  expect(decoded.every((d) => d.some((s) => s > 0.5))).toBe(true);
});

it("finds the quietest window", () => {
  const samples = chunk(2, 0.5);
  samples.fill(0.01, 1.2 * rate, 1.3 * rate);
  expect(quietest(samples, 0.5 * rate, 2 * rate) / rate).toBeCloseTo(1.25, 1);
});

it("fixes the capital letter where phrases meet", () => {
  expect(
    joinText([
      { text: "Fix the test." },
      { text: "and ping me" },
      { text: "When it is green", continued: true },
      { text: "I think", continued: true },
    ]),
  ).toBe("Fix the test. And ping me when it is green I think");
  expect(joinText([{ text: "" }, { text: "Hi." }, { text: "" }])).toBe("Hi.");
});
