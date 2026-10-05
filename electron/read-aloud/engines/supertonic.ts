import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type * as Ort from "onnxruntime-node";
import type { DictationModelFile } from "../../../shared/dictation";
import type { ReadAloudEngine, ReadAloudModel } from "../engine";
import { detectLanguage } from "./supertonic/language";
import {
  endsSentence,
  preprocess,
  speechChunks,
  spellVersions,
  textIds,
  type SupertonicLanguage,
} from "./supertonic/text";

const repo =
  "https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46";

const file = (
  path: string,
  size: number,
  sha256: string,
): DictationModelFile => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  url: `${repo}/${path}`,
  size,
  sha256,
});

// The preset voices speak every language the model knows; the language of
// each answer is detected from its text instead.
const voices = [
  ["F1", "F1 · calm, low"],
  ["F2", "F2 · bright, cheerful"],
  ["F3", "F3 · clear announcer"],
  ["F4", "F4 · crisp, confident"],
  ["F5", "F5 · soft, gentle"],
  ["M1", "M1 · lively, clear"],
  ["M2", "M2 · deep, calm"],
  ["M3", "M3 · polished, authoritative"],
  ["M4", "M4 · soft, friendly"],
  ["M5", "M5 · warm storyteller"],
].map(([id, name]) => ({ id, name, language: "mul" }));

const styleSha256: Record<string, [number, string]> = {
  F1: [
    292046,
    "bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2",
  ],
  F2: [
    292423,
    "7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6",
  ],
  F3: [
    290794,
    "12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab",
  ],
  F4: [
    291808,
    "c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b",
  ],
  F5: [
    291479,
    "45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d",
  ],
  M1: [
    291748,
    "e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b",
  ],
  M2: [
    292055,
    "b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50",
  ],
  M3: [
    290198,
    "ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b",
  ],
  M4: [
    291522,
    "ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303",
  ],
  M5: [
    291469,
    "dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2",
  ],
};

export interface SupertonicOptions {
  /** Flow-matching steps per chunk: fewer is faster, more is cleaner. */
  steps: number;
  /** Speaking rate; the model's durations are divided by it. */
  speed: number;
  /** Silence after a chunk that ends a sentence, in seconds. */
  pause: number;
  /** Silence after a chunk cut mid-sentence, in seconds. */
  clausePause: number;
}

export const supertonicDefaults: SupertonicOptions = {
  steps: 5,
  speed: 1.05,
  pause: 0.3,
  clausePause: 0.1,
};

export const supertonic: ReadAloudEngine = {
  id: "supertonic-3",
  name: "Supertonic 3",
  credit:
    "Supertonic 3 by Supertone Inc. Weights under the BigScience OpenRAIL-M license.",
  files: [
    file(
      "onnx/duration_predictor.onnx",
      3700147,
      "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db",
    ),
    file(
      "onnx/text_encoder.onnx",
      36416150,
      "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff",
    ),
    file(
      "onnx/vector_estimator.onnx",
      256534781,
      "883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c",
    ),
    file(
      "onnx/vocoder.onnx",
      101424195,
      "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba",
    ),
    file(
      "onnx/tts.json",
      8253,
      "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09",
    ),
    file(
      "onnx/unicode_indexer.json",
      277676,
      "9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f",
    ),
    file(
      "LICENSE",
      15007,
      "0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f",
    ),
    ...voices.map(({ id }) =>
      file(`voice_styles/${id}.json`, ...styleSha256[id]),
    ),
  ],
  voices,
  load: (ort, dir, threads) => loadSupertonic(ort, dir, threads),
};

interface Config {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { latent_dim: number; chunk_compress_factor: number };
}

interface Style {
  ttl: Ort.Tensor;
  dp: Ort.Tensor;
}

interface StyleFile {
  style_ttl: { dims: number[]; data: unknown[] };
  style_dp: { dims: number[]; data: unknown[] };
}

export async function loadSupertonic(
  ort: typeof Ort,
  dir: string,
  threads: number,
  options: SupertonicOptions = supertonicDefaults,
): Promise<ReadAloudModel> {
  const sessionOptions: Ort.InferenceSession.SessionOptions = {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    executionMode: "sequential",
    graphOptimizationLevel: "all",
  };
  const session = (name: string) =>
    ort.InferenceSession.create(join(dir, `${name}.onnx`), sessionOptions);
  const [
    config,
    indexer,
    durationPredictor,
    textEncoder,
    vectorEstimator,
    vocoder,
  ] = await Promise.all([
    readFile(join(dir, "tts.json"), "utf8").then(
      (json) => JSON.parse(json) as Config,
    ),
    readFile(join(dir, "unicode_indexer.json"), "utf8").then((json) =>
      Int32Array.from(JSON.parse(json) as number[]),
    ),
    session("duration_predictor"),
    session("text_encoder"),
    session("vector_estimator"),
    session("vocoder"),
  ]);
  const sampleRate = config.ae.sample_rate;
  const compress = config.ttl.chunk_compress_factor;
  const latentChunk = config.ae.base_chunk_size * compress;
  const latentDim = config.ttl.latent_dim * compress;
  const styles = new Map<string, Promise<Style>>();

  const tensor = (data: Float32Array, dims: readonly number[]) =>
    new ort.Tensor("float32", data, dims);

  async function readStyle(voice: string): Promise<Style> {
    const style = JSON.parse(
      await readFile(join(dir, `${voice}.json`), "utf8"),
    ) as StyleFile;
    const flat = ({ data, dims }: StyleFile["style_ttl"]) =>
      tensor(Float32Array.from(data.flat(Infinity) as number[]), dims);
    return { ttl: flat(style.style_ttl), dp: flat(style.style_dp) };
  }

  function styleFor(voice: string) {
    if (!(voice in styleSha256))
      throw new Error(`Supertonic has no voice "${voice}"`);
    let style = styles.get(voice);
    if (!style) {
      style = readStyle(voice);
      styles.set(voice, style);
      style.catch(() => styles.delete(voice));
    }
    return style;
  }

  /** One chunk of text to PCM, or null when `signal` aborted part way. */
  async function synthesize(
    text: string,
    lang: SupertonicLanguage,
    style: Style,
    signal: AbortSignal,
  ): Promise<Float32Array | null> {
    const ids = textIds(preprocess(text, lang), indexer);
    const textIdsTensor = new ort.Tensor(
      "int64",
      BigInt64Array.from(ids, BigInt),
      [1, ids.length],
    );
    const textMask = tensor(new Float32Array(ids.length).fill(1), [
      1,
      1,
      ids.length,
    ]);

    const { duration } = await durationPredictor.run({
      text_ids: textIdsTensor,
      style_dp: style.dp,
      text_mask: textMask,
    });
    const samples =
      ((duration.data as Float32Array)[0] / options.speed) * sampleRate;
    const { text_emb } = await textEncoder.run({
      text_ids: textIdsTensor,
      style_ttl: style.ttl,
      text_mask: textMask,
    });
    if (signal.aborted) return null;

    const latentLength = Math.floor((samples + latentChunk - 1) / latentChunk);
    const spoken = Math.floor(
      (Math.floor(samples) + latentChunk - 1) / latentChunk,
    );
    const mask = new Float32Array(latentLength);
    mask.fill(1, 0, spoken);
    let latent: Float32Array = new Float32Array(latentDim * latentLength);
    for (let row = 0; row < latentDim; row++) {
      for (let at = 0; at < spoken; at++)
        latent[row * latentLength + at] = gaussian();
    }
    const latentMask = tensor(mask, [1, 1, latentLength]);
    const totalStep = tensor(new Float32Array([options.steps]), [1]);
    for (let step = 0; step < options.steps; step++) {
      const { denoised_latent } = await vectorEstimator.run({
        noisy_latent: tensor(latent, [1, latentDim, latentLength]),
        text_emb,
        style_ttl: style.ttl,
        latent_mask: latentMask,
        text_mask: textMask,
        current_step: tensor(new Float32Array([step]), [1]),
        total_step: totalStep,
      });
      latent = denoised_latent.data as Float32Array;
      if (signal.aborted) return null;
    }
    const { wav_tts } = await vocoder.run({
      latent: tensor(latent, [1, latentDim, latentLength]),
    });
    return (wav_tts.data as Float32Array).subarray(0, Math.floor(samples));
  }

  return {
    sampleRate,
    async speak(text, voice, onAudio, signal) {
      // Inline code is read as its text rather than in quotes.
      text = text.replace(/`+/g, "");
      const lang = detectLanguage(text);
      if (lang === "en") text = spellVersions(text);
      const style = await styleFor(voice);
      let pause = 0;
      for (const chunk of speechChunks(text, lang)) {
        if (signal.aborted) return;
        const pcm = await synthesize(chunk, lang, style, signal);
        if (!pcm || signal.aborted) return;
        const audio = new Float32Array(pause + pcm.length);
        audio.set(pcm, pause);
        onAudio(audio);
        pause = Math.round(
          (endsSentence(chunk) ? options.pause : options.clausePause) *
            sampleRate,
        );
      }
    },
    async release() {
      await Promise.all(
        [durationPredictor, textEncoder, vectorEstimator, vocoder].map((s) =>
          s.release(),
        ),
      );
    },
  };
}

/** A standard normal sample (Box–Muller), the starting noise of flow matching. */
function gaussian() {
  const u = Math.max(1e-10, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
