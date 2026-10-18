import { dictationSampleRate as rate } from "../../shared/dictation";

// Parakeet's preprocessor as NeMo runs it: pre-emphasis, a 512-point STFT
// of 25 ms Hann windows every 10 ms, 128 Slaney mel bands, log, then each
// band normalized over the clip.
const fftSize = 512,
  windowLength = 400,
  hop = 160,
  bands = 128,
  preemphasis = 0.97;
export const featureBands = bands;

const bins = fftSize / 2 + 1;

/** The Hann window, centred in the FFT frame as torch.stft pads it. */
const window = (() => {
  const out = new Float32Array(fftSize),
    offset = (fftSize - windowLength) / 2;
  for (let n = 0; n < windowLength; n++)
    out[offset + n] =
      0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (windowLength - 1));
  return out;
})();

const hzToMel = (hz: number) =>
  hz < 1000 ? (3 * hz) / 200 : 15 + Math.log(hz / 1000) / (Math.log(6.4) / 27);
const melToHz = (mel: number) =>
  mel < 15
    ? (200 * mel) / 3
    : 1000 * Math.exp(((mel - 15) * Math.log(6.4)) / 27);

/** librosa's mel filters (htk=False, norm="slaney"), as [band][bin]. */
const filters = (() => {
  const top = hzToMel(rate / 2),
    edges = Array.from({ length: bands + 2 }, (_, i) =>
      melToHz((top * i) / (bands + 1)),
    );
  return Array.from({ length: bands }, (_, band) => {
    const [low, mid, high] = edges.slice(band, band + 3) as [
        number,
        number,
        number,
      ],
      scale = 2 / (high - low),
      weights = new Float32Array(bins);
    for (let bin = 0; bin < bins; bin++) {
      const hz = (bin * rate) / fftSize;
      const rise = (hz - low) / (mid - low),
        fall = (high - hz) / (high - mid);
      weights[bin] = Math.max(0, Math.min(rise, fall)) * scale;
    }
    return weights;
  });
})();

const bitReversed = (() => {
  const out = new Uint16Array(fftSize),
    bits = Math.log2(fftSize);
  for (let i = 0; i < fftSize; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    out[i] = r;
  }
  return out;
})();
const cos = Float64Array.from({ length: fftSize / 2 }, (_, i) =>
  Math.cos((2 * Math.PI * i) / fftSize),
);
const sin = Float64Array.from(
  { length: fftSize / 2 },
  (_, i) => -Math.sin((2 * Math.PI * i) / fftSize),
);

/** In-place radix-2 FFT of `re`/`im`, already in bit-reversed order. */
function fft(re: Float64Array, im: Float64Array) {
  for (let size = 2; size <= fftSize; size *= 2) {
    const half = size / 2,
      step = fftSize / size;
    for (let start = 0; start < fftSize; start += size)
      for (let k = 0; k < half; k++) {
        const a = start + k,
          b = a + half,
          wr = cos[k * step]!,
          wi = sin[k * step]!;
        const tr = re[b]! * wr - im[b]! * wi,
          ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
}

/**
 * 16 kHz samples as the encoder's input: `bands` rows of `frames` values,
 * band-major, as the [1, 128, frames] tensor wants them.
 */
export function logMel(samples: Float32Array) {
  const frames = Math.floor(samples.length / hop) + 1,
    out = new Float32Array(bands * frames),
    re = new Float64Array(fftSize),
    im = new Float64Array(fftSize),
    power = new Float64Array(bins);
  const emphasized = (i: number) =>
    samples[i]! - (i ? preemphasis * samples[i - 1]! : 0);
  // Mirrored at both ends, as torch.stft's centring pads the clip.
  const last = samples.length - 1;
  const at = (i: number) =>
    emphasized(
      Math.min(Math.max(i < 0 ? -i : i > last ? 2 * last - i : i, 0), last),
    );
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop - fftSize / 2;
    for (let n = 0; n < fftSize; n++) {
      re[bitReversed[n]!] = at(start + n) * window[n]!;
      im[n] = 0;
    }
    fft(re, im);
    for (let bin = 0; bin < bins; bin++)
      power[bin] = re[bin]! * re[bin]! + im[bin]! * im[bin]!;
    for (let band = 0; band < bands; band++) {
      const weights = filters[band]!;
      let sum = 0;
      for (let bin = 0; bin < bins; bin++) sum += weights[bin]! * power[bin]!;
      out[band * frames + frame] = Math.log(sum + 2 ** -24);
    }
  }
  for (let band = 0; band < bands; band++) {
    const row = out.subarray(band * frames, (band + 1) * frames);
    let mean = 0;
    for (const v of row) mean += v;
    mean /= frames;
    let variance = 0;
    for (const v of row) variance += (v - mean) ** 2;
    const std = Math.sqrt(variance / Math.max(1, frames - 1)) + 1e-5;
    for (let i = 0; i < frames; i++) row[i] = (row[i]! - mean) / std;
  }
  return { data: out, frames };
}
