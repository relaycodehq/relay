import type * as Ort from "onnxruntime-node";
import type { DictationModelFile } from "../../shared/dictation";

/** One text-to-speech model Relay can download and run on onnxruntime-node. */
export interface ReadAloudEngine {
  id: string;
  name: string;
  /** Who made it and the weights' license, as Settings shows it. */
  credit: string;
  /** Where the weights' license can be read; Settings links it. */
  license?: string;
  /** What gets downloaded into the engine's folder, pinned to a revision, with sizes and sha256. */
  files: DictationModelFile[];
  /** Voices it ships; the first is the default. */
  voices: { id: string; name: string; language: string }[];
  /** Loads the model from `dir`, where `files` were downloaded. */
  load(ort: typeof Ort, dir: string, threads: number): Promise<ReadAloudModel>;
}

export interface ReadAloudModel {
  sampleRate: number;
  /** Speaks `text` in `voice`, handing over mono float PCM as it is made; stops early when `signal` aborts. */
  speak(
    text: string,
    voice: string,
    onAudio: (pcm: Float32Array) => void,
    signal: AbortSignal,
  ): Promise<void>;
  release(): Promise<void>;
}

/** A standard normal sample (Box–Muller), the starting noise of flow matching. */
export function gaussian() {
  const u = Math.max(1e-10, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
