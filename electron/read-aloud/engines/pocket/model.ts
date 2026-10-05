/**
 * Pocket TTS on onnxruntime-node, following Kyutai's generation loop
 * (pocket_tts/models/tts_model.py) over KevinAHM's ONNX export.
 *
 * Per chunk of text: the voice's cached state is prompted with the text, then
 * the flow LM makes one 80 ms latent per step until it signals the end, and
 * the Mimi decoder turns latents into 24 kHz audio a few frames at a time.
 * Model state goes in and out of every run as tensors listed in bundle.json.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type * as Ort from "onnxruntime-node";
import type { ReadAloudModel } from "../../engine";
import { readSafetensors, type StoredTensor } from "./safetensors";
import { prepareText, splitIntoChunks } from "./text";
import { SentencePiece } from "./tokenizer";

export const modelFiles = {
  bundle: "bundle.json",
  tokenizer: "tokenizer.model",
  conditioner: "text_conditioner.onnx",
  flowLm: "flow_lm_main_int8.onnx",
  flow: "flow_lm_flow_int8.onnx",
  // The int8 decoder quantizes per run, so its audio shifts with how many frames go in at once.
  decoder: "mimi_decoder.onnx",
};

export const voiceFile = (voice: string) => `voice-${voice}.safetensors`;

export interface PocketOptions {
  /** Kyutai's default for english_2026-04 is 0.3; 0 makes generation deterministic. */
  temperature: number;
  files: typeof modelFiles;
}

const eosThreshold = -4;
const minFramesBeforeEos = 6;
const tokensPerSecond = 3;
const paddingSeconds = 2;
const flowSteps = 1;
// The first audio goes out after this many frames; later blocks grow up to the cap.
const firstDecodeFrames = 2;
const maxDecodeFrames = 8;

interface StateEntry {
  input_name: string;
  output_name: string;
  module: string;
  key: string;
  shape: number[];
  dtype: "float32" | "int64" | "bool";
  fill: "nan" | "zeros" | "ones" | "empty";
}

interface Bundle {
  sample_rate: number;
  frame_rate: number;
  latent_dim: number;
  conditioning_dim: number;
  max_token_per_chunk: number;
  pad_with_spaces_for_short_inputs: boolean;
  remove_semicolons: boolean;
  flow_lm_state_manifest: StateEntry[];
  mimi_state_manifest: StateEntry[];
}

type State = Record<string, Ort.Tensor>;

interface Voice {
  id: string;
  state: State;
  /** Cache positions the voice prompt already fills. */
  used: number;
}

export async function loadPocket(
  ort: typeof Ort,
  dir: string,
  threads: number,
  options: Partial<PocketOptions> = {},
): Promise<ReadAloudModel> {
  const temperature = options.temperature ?? 0.3;
  const files = options.files ?? modelFiles;
  const bundle = JSON.parse(
    await readFile(join(dir, files.bundle), "utf8"),
  ) as Bundle;
  // text.ts follows the english_2026-04 settings.
  if (bundle.pad_with_spaces_for_short_inputs || bundle.remove_semicolons)
    throw new Error("This Pocket TTS bundle prepares text differently.");
  const tokenizer = new SentencePiece(
    await readFile(join(dir, files.tokenizer)),
  );
  const sessionOptions: Ort.InferenceSession.SessionOptions = {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    executionMode: "sequential",
    graphOptimizationLevel: "all",
  };
  const open = (name: string) =>
    ort.InferenceSession.create(join(dir, name), sessionOptions);
  const sessions = await Promise.all([
    open(files.conditioner),
    open(files.flowLm),
    open(files.flow),
    open(files.decoder),
  ]);
  const [conditioner, flowLm, flow, decoder] = sessions;

  const flowManifest = bundle.flow_lm_state_manifest;
  const decoderManifest = bundle.mimi_state_manifest;
  const latentDim = bundle.latent_dim;
  const capacity = Math.min(
    ...flowManifest
      .filter((entry) => entry.key === "cache")
      .map((entry) => entry.shape[2]),
  );
  const emptySequence = new ort.Tensor("float32", new Float32Array(0), [
    1,
    0,
    latentDim,
  ]);
  const emptyText = new ort.Tensor("float32", new Float32Array(0), [
    1,
    0,
    bundle.conditioning_dim,
  ]);
  const bos = new ort.Tensor("float32", new Float32Array(latentDim).fill(NaN), [
    1,
    1,
    latentDim,
  ]);
  const times = Array.from(
    { length: flowSteps + 1 },
    (_, i) =>
      new ort.Tensor("float32", new Float32Array([i / flowSteps]), [1, 1]),
  );

  const initial = (manifest: StateEntry[]) =>
    Object.fromEntries(
      manifest.map((entry) => [entry.input_name, filled(ort, entry)]),
    );
  const next = (
    manifest: StateEntry[],
    outputs: Ort.InferenceSession.ReturnType,
  ) =>
    Object.fromEntries(
      manifest.map((entry) => [entry.input_name, outputs[entry.output_name]]),
    );

  let voice: Voice | undefined;
  const loadVoice = async (id: string): Promise<Voice> => {
    if (voice?.id === id) return voice;
    const stored = readSafetensors(await readFile(join(dir, voiceFile(id))));
    const state: State = {};
    let used = 0;
    for (const entry of flowManifest) {
      const source =
        stored.get(`${entry.module}/${entry.key}`) ??
        (entry.key === "step"
          ? stored.get(`${entry.module}/offset`)
          : undefined);
      state[entry.input_name] = source
        ? adapt(ort, source, entry)
        : filled(ort, entry);
      if (entry.key === "step" && source?.dtype === "int64")
        used = Math.max(used, Number(source.data[0]));
    }
    voice = { id, state, used };
    return voice;
  };

  const sample = async (conditioning: Ort.Tensor) => {
    const x = new Float32Array(latentDim);
    if (temperature > 0) {
      const std = Math.sqrt(temperature);
      for (let i = 0; i < latentDim; i++) x[i] = gaussian() * std;
    }
    for (let i = 0; i < flowSteps; i++) {
      const { flow_dir } = await flow.run({
        c: conditioning,
        s: times[i],
        t: times[i + 1],
        x: new ort.Tensor("float32", x, [1, latentDim]),
      });
      const direction = flow_dir.data as Float32Array;
      for (let j = 0; j < latentDim; j++) x[j] += direction[j] / flowSteps;
    }
    return x;
  };

  const speakChunk = async (
    text: string,
    base: Voice,
    onAudio: (pcm: Float32Array) => void,
    signal: AbortSignal,
  ) => {
    const prepared = prepareText(text);
    if (!prepared) return;
    const ids = tokenizer.encode(prepared.text);
    const { embeddings } = await conditioner.run({
      token_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [
        1,
        ids.length,
      ]),
    });
    if (signal.aborted) return;
    let state = next(
      flowManifest,
      await flowLm.run({
        sequence: emptySequence,
        text_embeddings: embeddings,
        ...base.state,
      }),
    );
    const limit = Math.min(
      Math.ceil(
        (ids.length / tokensPerSecond + paddingSeconds) * bundle.frame_rate,
      ),
      capacity - base.used - ids.length,
    );

    let decoderState = initial(decoderManifest);
    let pending: Float32Array[] = [];
    let decoded = 0;
    const decode = async () => {
      const latent = new Float32Array(pending.length * latentDim);
      pending.forEach((frame, i) => latent.set(frame, i * latentDim));
      const outputs = await decoder.run({
        latent: new ort.Tensor("float32", latent, [
          1,
          pending.length,
          latentDim,
        ]),
        ...decoderState,
      });
      decoderState = next(decoderManifest, outputs);
      decoded += pending.length;
      pending = [];
      if (!signal.aborted) onAudio(outputs.audio_frame.data as Float32Array);
    };

    let input = bos;
    let eosAt: number | undefined;
    for (let step = 0; step < limit; step++) {
      if (signal.aborted) return;
      const outputs = await flowLm.run({
        sequence: input,
        text_embeddings: emptyText,
        ...state,
      });
      state = next(flowManifest, outputs);
      const eos = (outputs.eos_logit.data as Float32Array)[0] > eosThreshold;
      if (eos && eosAt === undefined && step >= minFramesBeforeEos)
        eosAt = step;
      if (eosAt !== undefined && step >= eosAt + prepared.framesAfterEos) break;
      const latent = await sample(outputs.conditioning);
      input = new ort.Tensor("float32", latent, [1, 1, latentDim]);
      pending.push(latent);
      const block = decoded
        ? Math.min(maxDecodeFrames, Math.max(firstDecodeFrames, decoded))
        : firstDecodeFrames;
      if (pending.length >= block) await decode();
    }
    if (pending.length && !signal.aborted) await decode();
  };

  return {
    sampleRate: bundle.sample_rate,
    async speak(text, voiceId, onAudio, signal) {
      const base = await loadVoice(voiceId);
      for (const chunk of splitIntoChunks(
        tokenizer,
        text,
        bundle.max_token_per_chunk,
      )) {
        if (signal.aborted) return;
        await speakChunk(chunk, base, onAudio, signal);
      }
    },
    async release() {
      voice = undefined;
      await Promise.all(sessions.map((session) => session.release()));
    },
  };
}

function filled(ort: typeof Ort, entry: StateEntry): Ort.Tensor {
  const size = entry.shape.reduce((a, b) => a * b, 1);
  const value = entry.fill === "ones" ? 1 : 0;
  if (entry.dtype === "int64")
    return new ort.Tensor(
      "int64",
      new BigInt64Array(size).fill(BigInt(value)),
      entry.shape,
    );
  if (entry.dtype === "bool")
    return new ort.Tensor(
      "bool",
      new Uint8Array(size).fill(value),
      entry.shape,
    );
  const data = new Float32Array(size).fill(entry.fill === "nan" ? NaN : value);
  return new ort.Tensor("float32", data, entry.shape);
}

/** Fits a saved voice tensor into the model's state: same values, padded out to the full cache. */
function adapt(
  ort: typeof Ort,
  source: StoredTensor,
  entry: StateEntry,
): Ort.Tensor {
  if (source.dtype !== entry.dtype)
    throw new Error(
      `The voice's ${entry.module}/${entry.key} is ${source.dtype}, not ${entry.dtype}.`,
    );
  const size = entry.shape.reduce((a, b) => a * b, 1);
  if (source.data.length === size)
    return new ort.Tensor(entry.dtype, source.data.slice(), entry.shape);
  const target = filled(ort, entry);
  if (source.shape.length !== entry.shape.length) return target;
  copyCorner(
    source.data,
    source.shape,
    target.data as typeof source.data,
    entry.shape,
  );
  return target;
}

function copyCorner<T extends Float32Array | BigInt64Array>(
  source: T,
  sourceShape: number[],
  target: T,
  targetShape: number[],
) {
  const stride = (shape: number[], dim: number) =>
    shape.slice(dim + 1).reduce((a, b) => a * b, 1);
  const copy = (dim: number, from: number, to: number) => {
    const n = Math.min(sourceShape[dim], targetShape[dim]);
    if (dim === targetShape.length - 1) {
      (target as Float32Array).set(
        (source as Float32Array).subarray(from, from + n),
        to,
      );
      return;
    }
    for (let i = 0; i < n; i++)
      copy(
        dim + 1,
        from + i * stride(sourceShape, dim),
        to + i * stride(targetShape, dim),
      );
  };
  copy(0, 0, 0);
}

function gaussian() {
  const u = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
