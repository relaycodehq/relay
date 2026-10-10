import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReadAloudModel } from "../engine";
import { pocketTts } from "./pocket";

// Runs the real model, so only when RELAY_READ_ALOUD_MODELS names a folder
// holding every file in pocketTts.files.
const dir = process.env.RELAY_READ_ALOUD_MODELS;
const missing = dir
  ? pocketTts.files.filter((file) => !existsSync(join(dir, file.name)))
  : [];
const skip = !dir
  ? "RELAY_READ_ALOUD_MODELS isn't set"
  : missing.length
    ? `${dir} lacks ${missing.map((file) => file.name).join(", ")}`
    : "";
if (skip)
  process.stderr.write(`Skipping the Pocket TTS model test: ${skip}.\n`);

describe.skipIf(Boolean(skip))("Pocket TTS on the real model", () => {
  let model: ReadAloudModel;
  beforeAll(async () => {
    model = await pocketTts.load(await import("onnxruntime-node"), dir!, 4);
  });
  afterAll(() => model?.release());

  it("streams speech for a short line", async () => {
    const blocks: Float32Array[] = [];
    await model.speak(
      "Done. Typecheck passes.",
      "alba",
      (pcm) => blocks.push(pcm),
      new AbortController().signal,
    );
    // Streamed in pieces rather than handed over at the end.
    expect(blocks.length).toBeGreaterThan(2);

    const audio = Float32Array.from(blocks.flatMap((block) => [...block]));
    const seconds = audio.length / model.sampleRate;
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(4);
    const rms = Math.sqrt(
      audio.reduce((sum, x) => sum + x * x, 0) / audio.length,
    );
    expect(rms).toBeGreaterThan(0.01);
    expect(audio.every((x) => Number.isFinite(x) && Math.abs(x) <= 1)).toBe(
      true,
    );
  });

  it("stops soon after it is aborted, with no audio after", async () => {
    const controller = new AbortController();
    let afterAbort = 0;
    let abortedAt = 0;
    const speaking = model.speak(
      "I found the bug in turn-run.ts: when the second request finishes before the first, the old one overwrites the newer state.",
      "george",
      () => {
        if (controller.signal.aborted) afterAbort++;
        else if (!abortedAt) {
          abortedAt = performance.now();
          controller.abort();
        }
      },
      controller.signal,
    );
    await speaking;
    expect(abortedAt).toBeGreaterThan(0);
    expect(performance.now() - abortedAt).toBeLessThan(250);
    expect(afterAbort).toBe(0);
  });
});
