import { join } from "node:path";
import { dictationSampleRate as rate } from "../../shared/dictation";
import type { SpeechEngine } from "./transcriber";

// sherpa-onnx-node, loaded from the copy beside the bundle (see build-electron.mjs).
interface Sherpa {
  OfflineRecognizer: {
    createAsync(config: object): Promise<{
      createStream(): {
        acceptWaveform(wave: {
          samples: Float32Array;
          sampleRate: number;
        }): void;
      };
      decodeAsync(stream: unknown): Promise<{ text: string }>;
    }>;
  };
  Vad: new (
    config: object,
    bufferSeconds: number,
  ) => {
    acceptWaveform(samples: Float32Array): void;
    isDetected(): boolean;
    isEmpty(): boolean;
    pop(): void;
    reset(): void;
  };
}

const vadWindow = 512;

export async function loadSherpaEngine(
  sherpa: Sherpa,
  dir: string,
  threads: number,
): Promise<SpeechEngine> {
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: rate, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(dir, "encoder.int8.onnx"),
        decoder: join(dir, "decoder.int8.onnx"),
        joiner: join(dir, "joiner.int8.onnx"),
      },
      tokens: join(dir, "tokens.txt"),
      modelType: "nemo_transducer",
      numThreads: threads,
      provider: "cpu",
    },
  });
  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: join(dir, "silero_vad.onnx"),
        threshold: 0.4,
        // Short: the transcriber decides which pauses end a phrase.
        minSilenceDuration: 0.3,
        minSpeechDuration: 0.2,
        windowSize: vadWindow,
      },
      sampleRate: rate,
      numThreads: 1,
      provider: "cpu",
    },
    30,
  );
  // Silero takes exactly one window at a time.
  let pending = new Float32Array(0);
  return {
    async decode(samples) {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples, sampleRate: rate });
      return (await recognizer.decodeAsync(stream)).text;
    },
    detect(samples) {
      const all = new Float32Array(pending.length + samples.length);
      all.set(pending);
      all.set(samples, pending.length);
      let at = 0;
      for (; at + vadWindow <= all.length; at += vadWindow)
        vad.acceptWaveform(all.slice(at, at + vadWindow));
      pending = all.slice(at);
      // Only the live flag matters; drop the segments it collects.
      while (!vad.isEmpty()) vad.pop();
      return vad.isDetected();
    },
    resetDetector() {
      vad.reset();
      pending = new Float32Array(0);
    },
  };
}
