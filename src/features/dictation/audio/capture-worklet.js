// Collects the microphone's 16 kHz samples into 80 ms chunks for the speech engine.
class DictationCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(1280);
    this.at = 0;
    this.port.onmessage = () => {
      this.flush();
      this.port.postMessage("flushed");
    };
  }

  flush() {
    if (!this.at) return;
    const out = this.chunk.slice(0, this.at);
    this.port.postMessage(out, [out.buffer]);
    this.at = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length;) {
      const n = Math.min(input.length - i, this.chunk.length - this.at);
      this.chunk.set(input.subarray(i, i + n), this.at);
      this.at += n;
      i += n;
      if (this.at === this.chunk.length) this.flush();
    }
    return true;
  }
}

registerProcessor("dictation-capture", DictationCapture);
