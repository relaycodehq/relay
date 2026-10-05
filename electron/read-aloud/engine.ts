import type * as Ort from "onnxruntime-node";
import type { DictationModelFile } from "../../shared/dictation";

/** One text-to-speech model Relay can download and run on onnxruntime-node. */
export interface ReadAloudEngine {
  id: string;
  name: string;
  /** Who made it and the weights' license, as Settings shows it. */
  credit: string;
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
