import type * as Ort from "onnxruntime-node";
import { dictationSampleRate as rate } from "../../shared/dictation";

/** Silero takes exactly this many samples at a time. */
const window = 512;
// Low enough for a whisper, which Silero is never sure of.
const threshold = 0.25;
// Short: the transcriber decides which pauses end a phrase.
const minSilence = 0.3 * rate,
  minSpeech = 0.2 * rate;

/**
 * Hears whether someone is talking, a window at a time, with a little
 * patience either way so one loud click or one breath doesn't flip it.
 */
export class SpeechGate {
  private heard = 0;
  private speechFrom?: number;
  private silenceFrom?: number;
  private speaking = false;

  /** The next window's speech probability; answers whether speech is going on. */
  step(probability: number) {
    this.heard += window;
    if (probability > threshold) {
      this.silenceFrom = undefined;
      if (!this.speaking) {
        this.speechFrom ??= this.heard;
        this.speaking = this.heard - this.speechFrom >= minSpeech;
      }
    } else if (!this.speaking) this.speechFrom = undefined;
    // Speech fades out a little below the bar it had to clear to start.
    else if (probability <= threshold - 0.15) {
      this.silenceFrom ??= this.heard;
      if (this.heard - this.silenceFrom >= minSilence) {
        this.speaking = false;
        this.speechFrom = this.silenceFrom = undefined;
      }
    }
    return this.speaking;
  }
}

const targetLevel = 10 ** (-30 / 20),
  maxGain = 100,
  /** About 3 s of windows. */
  levelHistory = 94;

/**
 * Brings quiet input up for the voice detector alone. Silero misses a
 * whisper below about -60 dBFS, and phones apply no gain of their own;
 * Parakeet normalizes what it's given, so it gets the audio as it came.
 * Steered by the loudest stretch of the last few seconds, so the noise
 * between words isn't pumped up to speech; never turns anything down.
 */
export class LevelGain {
  private levels: number[] = [];

  apply(window: Float32Array) {
    let energy = 0;
    for (const v of window) energy += v * v;
    this.levels.push(Math.sqrt(energy / window.length));
    if (this.levels.length > levelHistory) this.levels.shift();
    const sorted = [...this.levels].sort((a, b) => a - b);
    const loud = sorted[Math.floor(sorted.length * 0.9)]!;
    const gain = Math.min(maxGain, Math.max(1, targetLevel / (loud + 1e-6)));
    return gain === 1
      ? window
      : window.map((v) => Math.max(-1, Math.min(1, v * gain)));
  }
}

export type VoiceDetector = (samples: Float32Array) => Promise<boolean>;

/** Silero VAD (v4, with LSTM state), shared; each call to the result starts a detector of its own. */
export async function loadSilero(ort: typeof Ort, path: string) {
  const session = await ort.InferenceSession.create(path, {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    executionMode: "sequential",
  });
  const zero = (): Ort.Tensor =>
    new ort.Tensor("float32", new Float32Array(2 * 64), [2, 1, 64]);
  return (): VoiceDetector => {
    let h = zero(),
      c = zero(),
      speaking = false,
      pending = new Float32Array(0);
    const gate = new SpeechGate();
    const gain = new LevelGain();
    // Calls must not overlap: each window carries the last one's state.
    return async (samples) => {
      const all = new Float32Array(pending.length + samples.length);
      all.set(pending);
      all.set(samples, pending.length);
      let at = 0;
      for (; at + window <= all.length; at += window) {
        const out = await session.run({
          x: new ort.Tensor(
            "float32",
            gain.apply(all.slice(at, at + window)),
            [1, window],
          ),
          h,
          c,
        });
        h = out.new_h!;
        c = out.new_c!;
        speaking = gate.step((out.prob!.data as Float32Array)[0]!);
      }
      pending = all.slice(at);
      return speaking;
    };
  };
}
