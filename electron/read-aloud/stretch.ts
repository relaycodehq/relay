/**
 * Speeds speech up or slows it down without changing its pitch (WSOLA): short
 * windowed frames are taken from the input `speed` times further apart than
 * they are laid down, each nudged by up to 10 ms to where it lines up best with
 * the previous one, so the waveform stays continuous. Works on a stream: push
 * audio as it comes, flush at the end.
 */
export class Stretch {
  private readonly size: number;
  private readonly hop: number;
  private readonly step: number;
  private readonly tolerance: number;
  private readonly window: Float32Array;
  private readonly sum: Float32Array;
  private input = new Float32Array(0);
  /** Absolute index of `input[0]` in the stream. */
  private start = 0;
  private frame = 0;
  private previous = 0;
  private received = 0;
  private emitted = 0;

  constructor(
    readonly speed: number,
    sampleRate: number,
  ) {
    this.size = 2 * Math.round(sampleRate * 0.015);
    this.hop = this.size / 2;
    this.step = this.hop * speed;
    this.tolerance = Math.round(sampleRate * 0.01);
    this.window = new Float32Array(this.size);
    for (let i = 0; i < this.size; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.size);
    }
    this.sum = new Float32Array(this.size);
  }

  push(pcm: Float32Array): Float32Array {
    if (this.speed === 1) return pcm;
    this.append(pcm);
    this.received += pcm.length;
    return this.run();
  }

  /** The rest, once the input has ended. */
  flush(): Float32Array {
    if (this.speed === 1) return new Float32Array(0);
    const expected = Math.round(this.received / this.speed);
    const parts: Float32Array[] = [];
    while (this.emitted < expected) {
      this.append(new Float32Array(this.size + 2 * this.tolerance));
      parts.push(this.run());
    }
    const out = join(parts);
    const extra = this.emitted - expected;
    this.emitted = expected;
    return out.subarray(0, out.length - extra);
  }

  private append(pcm: Float32Array) {
    const keep = Math.max(
      0,
      Math.min(this.previous + this.hop, this.nominal() - this.tolerance) -
        this.start,
    );
    const next = new Float32Array(this.input.length - keep + pcm.length);
    next.set(this.input.subarray(keep));
    next.set(pcm, this.input.length - keep);
    this.input = next;
    this.start += keep;
  }

  private nominal() {
    return Math.round(this.frame * this.step);
  }

  private run(): Float32Array {
    const parts: Float32Array[] = [];
    const end = this.start + this.input.length;
    for (;;) {
      const nominal = this.nominal();
      let at = nominal;
      if (this.frame > 0) {
        const natural = this.previous + this.hop;
        const low = Math.max(0, nominal - this.tolerance);
        const high = nominal + this.tolerance;
        if (Math.max(high, natural) + this.size > end) break;
        at = this.bestMatch(natural, low, high);
      } else if (this.size > end) break;

      const offset = at - this.start;
      for (let i = 0; i < this.size; i++) {
        // The very first frame has nothing before it to fade in against.
        const weight = this.frame === 0 && i < this.hop ? 1 : this.window[i];
        this.sum[i] += weight * this.input[offset + i];
      }
      parts.push(this.sum.slice(0, this.hop));
      this.sum.copyWithin(0, this.hop);
      this.sum.fill(0, this.size - this.hop);
      this.previous = at;
      this.frame++;
      this.emitted += this.hop;
    }
    return join(parts);
  }

  /** The frame start in [low, high] whose audio best continues the frame at `natural`. */
  private bestMatch(natural: number, low: number, high: number) {
    const x = this.input;
    const reference = natural - this.start;
    let best = low;
    let bestScore = -Infinity;
    for (let at = low; at <= high; at++) {
      const offset = at - this.start;
      let dot = 0;
      let energy = 1e-9;
      for (let i = 0; i < this.size; i += 2) {
        const v = x[offset + i];
        dot += v * x[reference + i];
        energy += v * v;
      }
      const score = dot / Math.sqrt(energy);
      if (score > bestScore) {
        bestScore = score;
        best = at;
      }
    }
    return best;
  }
}

function join(parts: Float32Array[]) {
  if (parts.length === 1) return parts[0];
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
