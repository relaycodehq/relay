import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { supertonic } from "./supertonic";

// Opt-in: RELAY_READ_ALOUD_MODELS points at a folder holding the engine's
// files, directly or in a "supertonic-3" folder inside it.
const root = process.env.RELAY_READ_ALOUD_MODELS;
const dir =
  root &&
  (existsSync(join(root, "tts.json")) ? root : join(root, supertonic.id));
const skip = !dir || !existsSync(join(dir, "tts.json"));

it.runIf(skip)("skips the real model without RELAY_READ_ALOUD_MODELS", () => {
  console.info(
    "Skipped the real Supertonic tests: set RELAY_READ_ALOUD_MODELS to a folder with its downloaded files.",
  );
});

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

describe.skipIf(skip)("Supertonic on the real model", () => {
  const load = async () =>
    supertonic.load(await import("onnxruntime-node"), dir!, 4);

  it("has the files it pins", async () => {
    for (const file of supertonic.files) {
      expect(await sha256(join(dir!, file.name)), file.name).toBe(file.sha256);
    }
  });

  it("speaks a short answer as audible, unclipped audio", async () => {
    const model = await load();
    const parts: Float32Array[] = [];
    await model.speak(
      "Done. Typecheck passes.",
      supertonic.voices[0].id,
      (pcm) => parts.push(pcm),
      new AbortController().signal,
    );
    await model.release();
    const pcm = Float32Array.from(parts.flatMap((part) => [...part]));
    const seconds = pcm.length / model.sampleRate;
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(4);
    const rms = Math.sqrt(pcm.reduce((sum, s) => sum + s * s, 0) / pcm.length);
    expect(rms).toBeGreaterThan(0.01);
    expect(Math.max(...pcm.map(Math.abs))).toBeLessThan(1);
  });

  it("stops soon after the signal aborts", async () => {
    const model = await load();
    const abort = new AbortController();
    const long = Array.from(
      { length: 20 },
      (_, i) => `This is sentence ${i}, which goes on for a while.`,
    ).join(" ");
    let chunks = 0;
    let abortedAt = 0;
    await model.speak(
      long,
      "M1",
      () => {
        chunks++;
        abortedAt = performance.now();
        abort.abort();
      },
      abort.signal,
    );
    const stopped = performance.now() - abortedAt;
    await model.release();
    expect(chunks).toBe(1);
    expect(stopped).toBeLessThan(500);
  });
});
