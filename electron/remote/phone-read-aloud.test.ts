import { afterEach, expect, it, vi } from "vitest";
import { maxReadAloudPull } from "../../shared/remote";
import {
  PhoneReadings,
  type VoiceService,
  type VoiceSpeech,
} from "./phone-read-aloud";

afterEach(() => {
  vi.useRealTimers();
});

function fakeVoice() {
  const readings: { sink: (s: VoiceSpeech) => void; stopped: boolean }[] = [];
  const voice: VoiceService = {
    ready: () => true,
    speak(_markdown, sink) {
      const reading = { sink, stopped: false };
      readings.push(reading);
      return { stop: () => (reading.stopped = true) };
    },
  };
  return { voice, readings };
}

const samples = (pcm: string) =>
  Array.from(new Int16Array(new Uint8Array(Buffer.from(pcm, "base64")).buffer));

it("hands over audio a pull at a time, as 16-bit PCM, then says it's done", () => {
  const { voice, readings } = fakeVoice();
  const phone = new PhoneReadings(voice);
  phone.handle("fold", { type: "start", id: 1, markdown: "Hello" });
  const sink = readings[0].sink;
  const rate = 10;
  sink({ type: "audio", sampleRate: rate, pcm: Float32Array.of(1, -1, 0.5) });
  sink({
    type: "audio",
    sampleRate: rate,
    pcm: new Float32Array(rate * maxReadAloudPull).fill(2),
  });

  const first = phone.handle("fold", { type: "pull", id: 1 });
  const got = samples(first.pcm);
  expect(got).toHaveLength(rate * maxReadAloudPull);
  expect(got.slice(0, 4)).toEqual([32767, -32767, 16384, 32767]);
  expect(first.done).toBe(false);

  sink({ type: "end" });
  const last = phone.handle("fold", { type: "pull", id: 1 });
  expect(samples(last.pcm)).toHaveLength(3);
  expect(last.done).toBe(true);
  expect(() => phone.handle("fold", { type: "pull", id: 1 })).toThrow(
    "ended on the computer",
  );
});

it("plays what a failed reading made before showing the error", () => {
  const { voice, readings } = fakeVoice();
  const phone = new PhoneReadings(voice);
  phone.handle("fold", { type: "start", id: 1, markdown: "Hello" });
  readings[0].sink({
    type: "audio",
    sampleRate: 24000,
    pcm: Float32Array.of(0.1),
  });
  readings[0].sink({ type: "end", error: "The model broke." });

  const pulled = phone.handle("fold", { type: "pull", id: 1 });
  expect(samples(pulled.pcm)).toHaveLength(1);
  expect(pulled.done).toBe(false);
  expect(() => phone.handle("fold", { type: "pull", id: 1 })).toThrow(
    "The model broke.",
  );
});

it("stops the old reading when the phone starts another, and on stop", () => {
  const { voice, readings } = fakeVoice();
  const phone = new PhoneReadings(voice);
  phone.handle("fold", { type: "start", id: 1, markdown: "One" });
  phone.handle("fold", { type: "start", id: 2, markdown: "Two" });
  expect(readings[0].stopped).toBe(true);
  // A late pull for the old reading doesn't get the new one's audio.
  expect(() => phone.handle("fold", { type: "pull", id: 1 })).toThrow();

  phone.handle("fold", { type: "stop", id: 2 });
  expect(readings[1].stopped).toBe(true);
});

it("drops the reading of a phone that stopped pulling", () => {
  vi.useFakeTimers();
  const { voice, readings } = fakeVoice();
  const phone = new PhoneReadings(voice);
  phone.handle("fold", { type: "start", id: 1, markdown: "Hello" });
  vi.advanceTimersByTime(9_000);
  phone.handle("fold", { type: "pull", id: 1 });
  vi.advanceTimersByTime(9_000);
  expect(readings[0].stopped).toBe(false);
  vi.advanceTimersByTime(2_000);
  expect(readings[0].stopped).toBe(true);
});
