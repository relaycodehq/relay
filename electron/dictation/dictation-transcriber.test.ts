import { it, expect, vi } from "vitest";
import {
  joinText,
  quietest,
  Transcriber,
  withoutRepeat,
  type SpeechEngine,
  type Word,
} from "./transcriber";

const rate = 16000;

/**
 * Each decode answers with one word per 0.1 s of speech it was given, named
 * after the sample value, so tests can tell which audio reached which decode.
 */
function fakeEngine() {
  const decoded: Float32Array[] = [];
  const engine: SpeechEngine = {
    async decode(samples) {
      decoded.push(samples);
      const words: Word[] = [];
      for (let at = 0; at + rate / 10 <= samples.length; at += rate / 10) {
        const value = samples[at];
        if (value > 0.5) words.push({ text: `w${Math.round(value * 10)}`, at });
      }
      return { text: words.map((w) => w.text).join(" "), words };
    },
  };
  return { engine, decoded };
}

/** Pushes audio as the voice detector would hear it: speech is any sample above 0.5. */
const feed = (transcriber: Transcriber, samples: Float32Array) =>
  transcriber.push(
    samples,
    samples.some((s) => s > 0.5),
  );

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
  feed(transcriber, chunk(1, 0));
  feed(transcriber, chunk(0.2, 0.3)); // a soft first syllable the detector missed
  feed(transcriber, chunk(0.5, 0.9));
  await transcriber.stop();
  expect(decoded[0].some((s) => Math.abs(s - 0.3) < 1e-6)).toBe(true);
});

it("keeps a word that starts before the detector noticed the pause", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {});
  feed(transcriber, chunk(0.5, 0.9));
  // The chunk that closes the phrase already holds the next word's onset.
  feed(transcriber, new Float32Array([...chunk(0.2, 0), ...chunk(0.1, 0.3)]));
  feed(transcriber, chunk(0.5, 0.8));
  await transcriber.stop();
  const next = decoded.find((d) => d.some((s) => Math.abs(s - 0.8) < 1e-6))!;
  expect(next.some((s) => Math.abs(s - 0.3) < 1e-6)).toBe(true);
});

it("keeps talking through a pause to think in one phrase", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {});
  feed(transcriber, chunk(0.5, 0.9));
  feed(transcriber, chunk(1.2, 0));
  feed(transcriber, chunk(0.5, 0.8));
  await transcriber.stop();
  const last = decoded.at(-1)!;
  expect(last.some((s) => Math.abs(s - 0.9) < 1e-6)).toBe(true);
  expect(last.some((s) => Math.abs(s - 0.8) < 1e-6)).toBe(true);
});

it("stops decoding again while nothing is said", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {});
  feed(transcriber, chunk(0.5, 0.9));
  await new Promise((resolve) => setTimeout(resolve));
  const before = decoded.length;
  for (let tenth = 0; tenth < 15; tenth++) {
    feed(transcriber, chunk(0.1, 0));
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
    feed(transcriber, chunk(0.4, value));
    await new Promise((resolve) => setTimeout(resolve));
  }
  const text = await transcriber.stop();
  // Each word said four times in a row comes out once.
  expect(text).toBe("w7 w8 w9");
  for (let i = 1; i < seen.length; i++)
    expect(seen[i].startsWith(seen[i - 1])).toBe(true);
});

it("splits a phrase with no pause at its quietest moment", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {}, { maxPhrase: 3 });
  // Barely speech from 2.5 s to 2.6 s: the breath between two words.
  for (let tenth = 0; tenth < 40; tenth++)
    feed(transcriber, chunk(0.1, tenth === 25 ? 0.51 : 0.9));
  await transcriber.stop();
  const ends = decoded.map((d) => lastSpeech(d) / rate);
  expect(ends.some((end) => end > 2.5 && end < 2.6)).toBe(true);
});

it("ends a phrase that runs out of room in a pause instead of splitting it", async () => {
  const { engine, decoded } = fakeEngine();
  const transcriber = new Transcriber(engine, () => {}, { maxPhrase: 1 });
  feed(transcriber, chunk(0.8, 0.9));
  for (let tenth = 0; tenth < 10; tenth++) feed(transcriber, chunk(0.1, 0));
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

it("waits for as much new audio as a slow decode took before decoding again", async () => {
  const { engine, decoded } = fakeEngine();
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const decode = engine.decode;
  engine.decode = (samples) => {
    clock += 1000;
    return decode(samples);
  };
  try {
    const transcriber = new Transcriber(engine, () => {});
    // 3 s of speech without a pause, as it streams in.
    for (let i = 0; i < 30; i++) {
      feed(transcriber, chunk(0.1, 0.9));
      await new Promise((resolve) => setTimeout(resolve));
    }
    // Every 0.3 s would be 10 decodes; a 1 s decode spaces them a second apart.
    expect(decoded.length).toBeLessThanOrEqual(4);
  } finally {
    vi.restoreAllMocks();
  }
});

/** Speech that never pauses, a new word every 0.1 s: w1, w2… w9 and round again. */
async function talkNonstop(transcriber: Transcriber, seconds: number) {
  for (let tenth = 0; tenth < seconds * 10; tenth++) {
    feed(transcriber, chunk(0.1, 0.51 + (tenth % 9) * 0.05));
    await new Promise((resolve) => setTimeout(resolve));
  }
}

it("settles words two decodes agreed on so a long phrase stops being guessed again", async () => {
  // Every 0.1 s its own word, named after the sample value.
  const decoded: Float32Array[] = [];
  const engine: SpeechEngine = {
    async decode(samples) {
      decoded.push(samples);
      const words: Word[] = [];
      for (let at = 0; at + rate / 10 <= samples.length; at += rate / 10)
        if (samples[at + rate / 20] > 0.5)
          words.push({
            text: `w${Math.round(samples[at + rate / 20] * 1000)}`,
            at,
          });
      return { text: words.map((w) => w.text).join(" "), words };
    },
  };
  const settled: string[] = [];
  const transcriber = new Transcriber(engine, (text) => settled.push(text));
  for (let tenth = 0; tenth < 100; tenth++) {
    feed(transcriber, chunk(0.1, 0.51 + tenth * 0.004));
    await new Promise((resolve) => setTimeout(resolve));
  }
  // Settled while still talking, and only the unsettled end is decoded again.
  expect(settled.at(-1)!.split(" ").length).toBeGreaterThan(50);
  expect(
    Math.max(...decoded.slice(-5).map((d) => d.length)) / rate,
  ).toBeLessThan(6);
  const words = (await transcriber.stop()).split(" ");
  expect(new Set(words).size).toBe(words.length);
  expect(words.length).toBeGreaterThanOrEqual(98);
});

it("keeps a split phrase's words on screen until both halves are decoded again", async () => {
  const { engine } = fakeEngine();
  const counts: number[] = [];
  const transcriber = new Transcriber(
    engine,
    (settled, tentative) =>
      counts.push([settled, tentative].join(" ").trim().split(/\s+/).length),
    { maxPhrase: 3, settleBehind: 100 },
  );
  await talkNonstop(transcriber, 7);
  for (let i = 1; i < counts.length; i++)
    expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
  await transcriber.stop();
});

it("drops the settled words the next phrase hears again, even with its first word clipped", () => {
  const words = (text: string) =>
    text.split(" ").map((t, i) => ({ text: t, at: i * rate * 0.2 }));
  const settled = ["it", "like", "jumps", "between", "the", "whole"];
  expect(
    withoutRepeat(words("Ole the whole sentences and"), settled).text,
  ).toBe("sentences and");
  expect(withoutRepeat(words("Whole, sentences and"), settled).text).toBe(
    "sentences and",
  );
});

it("keeps the last guess when a decode suddenly hears most of the phrase as nothing", async () => {
  const { engine } = fakeEngine();
  const decode = engine.decode;
  let calls = 0;
  engine.decode = async (samples) =>
    ++calls === 4 ? { text: "", words: [] } : decode(samples);
  const shown: string[] = [];
  const transcriber = new Transcriber(engine, (_, tentative) =>
    shown.push(tentative),
  );
  await talkNonstop(transcriber, 2);
  expect(shown.slice(1).every((text) => text.length > 0)).toBe(true);
  await transcriber.stop();
});
