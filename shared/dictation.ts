/** Speech runs at 16 kHz mono float samples end to end. */
export const dictationSampleRate = 16000;

export interface DictationModelFile {
  name: string;
  url: string;
  size: number;
  sha256: string;
}

const parakeet =
  "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78";

/** NVIDIA Parakeet TDT 0.6B v3 (25 European languages) and Silero VAD, as sherpa-onnx exports. */
export const dictationModel = {
  id: "parakeet-tdt-0.6b-v3-int8",
  name: "Parakeet TDT 0.6B v3",
  files: [
    {
      name: "encoder.int8.onnx",
      url: `${parakeet}/encoder.int8.onnx`,
      size: 652184281,
      sha256:
        "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
    },
    {
      name: "decoder.int8.onnx",
      url: `${parakeet}/decoder.int8.onnx`,
      size: 11845275,
      sha256:
        "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
    },
    {
      name: "joiner.int8.onnx",
      url: `${parakeet}/joiner.int8.onnx`,
      size: 6355277,
      sha256:
        "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
    },
    {
      name: "tokens.txt",
      url: `${parakeet}/tokens.txt`,
      size: 93939,
      sha256:
        "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
    },
    {
      name: "silero_vad.onnx",
      url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
      size: 643854,
      sha256:
        "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
    },
  ] satisfies DictationModelFile[],
};

export const dictationModelSize = dictationModel.files.reduce(
  (sum, file) => sum + file.size,
  0,
);

export type DictationModelState =
  /** `received` bytes of an unfinished download are already on disk. */
  | { status: "missing"; received?: number }
  | { status: "downloading"; received: number; total: number }
  | { status: "ready" }
  | { status: "failed"; error: string; received: number; total: number }
  /** This platform has no speech engine build. */
  | { status: "unsupported" };

/** Renderer → engine, over the dictation MessagePort. */
export type DictationRequest =
  | { type: "start"; id: number }
  /** 16 kHz mono samples. */
  | { type: "audio"; id: number; samples: Float32Array }
  /** Finish the words heard so far and answer with "final". */
  | { type: "stop"; id: number }
  | { type: "cancel"; id: number };

/** Engine → renderer. */
export type DictationEvent =
  /** The model finished loading; words start arriving after this. */
  | { type: "ready" }
  /** Everything heard so far: `settled` won't change, `tentative` may. */
  | { type: "text"; id: number; settled: string; tentative: string }
  | { type: "final"; id: number; text: string }
  | { type: "error"; id?: number; message: string };
