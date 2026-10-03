import { dictationSampleRate } from "../../../../shared/dictation";
// A file of its own: the page's policy allows no data: or blob: scripts.
import workletUrl from "./capture-worklet.js?url&no-inline";

export interface Capture {
  /** Live view of the microphone for drawing it. */
  analyser: AnalyserNode;
  /** Sends the last partial chunk, then releases the microphone. */
  stop(): Promise<void>;
}

/** Opens the microphone at 16 kHz mono and hands over 80 ms chunks. */
export async function startCapture(
  deviceId: string | undefined,
  onAudio: (samples: Float32Array) => void,
): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  // Chromium resamples the microphone to the context's rate.
  const context = new AudioContext({ sampleRate: dictationSampleRate });
  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
    throw error;
  }
  const source = context.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(context, "dictation-capture");
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(worklet);
  source.connect(analyser);
  // Only nodes that reach the output get rendered; the worklet writes silence.
  worklet.connect(context.destination);
  worklet.port.onmessage = ({ data }) => {
    if (data instanceof Float32Array) onAudio(data);
  };
  return {
    analyser,
    async stop() {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 300);
        worklet.port.addEventListener("message", ({ data }) => {
          if (data === "flushed") {
            clearTimeout(timer);
            resolve();
          }
        });
        worklet.port.postMessage("flush");
      });
      stream.getTracks().forEach((track) => track.stop());
      source.disconnect();
      worklet.disconnect();
      await context.close();
    },
  };
}
