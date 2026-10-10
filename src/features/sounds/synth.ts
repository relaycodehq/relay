/**
 * The built-in sounds, made with Web Audio rather than shipped as files: bells
 * from a few decaying partials, wood and clicks from filtered noise. Each
 * family has a Done sound that lands home and a Needs-you sibling that stops
 * on an open interval, so it reads as a question.
 */
import type { BuiltInSoundId } from "../../../shared/sounds";

type Play = (ctx: BaseAudioContext, out: AudioNode, at: number) => void;
/** Frequency ratio, level and decay in seconds of each partial. */
type Partials = readonly (readonly [number, number, number])[];

function envelope(
  ctx: BaseAudioContext,
  at: number,
  peak: number,
  attack: number,
  decay: number,
) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return gain;
}

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  level: number,
  decay: number,
) {
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  osc.connect(envelope(ctx, at, level, 0.004, decay)).connect(out);
  osc.start(at);
  osc.stop(at + decay + 0.06);
}

function bell(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  partials: Partials,
  level: number,
) {
  for (const [ratio, amp, decay] of partials)
    tone(ctx, out, at, freq * ratio, level * amp, decay);
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseOf(ctx: BaseAudioContext) {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(
      1,
      Math.round(ctx.sampleRate * 0.3),
      ctx.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

function burst(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  {
    freq,
    q = 1,
    type = "bandpass",
    level,
    decay,
  }: {
    freq: number;
    q?: number;
    type?: BiquadFilterType;
    level: number;
    decay: number;
  },
) {
  const source = ctx.createBufferSource();
  source.buffer = noiseOf(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  source
    .connect(filter)
    .connect(envelope(ctx, at, level, 0.001, decay))
    .connect(out);
  source.start(at);
  source.stop(at + decay + 0.06);
}

/** A triangle string whose brightness falls away as it rings. */
function pluck(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  decay: number,
  darkens: number,
) {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(5000, at);
  filter.frequency.exponentialRampToValueAtTime(darkens, at + 0.25);
  osc
    .connect(filter)
    .connect(envelope(ctx, at, 0.35, 0.003, decay))
    .connect(out);
  osc.start(at);
  osc.stop(at + decay + 0.1);
}

/** A sine that slides up, like a bubble popping. */
function pop(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  from: number,
  to: number,
  level: number,
) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + 0.08);
  osc.connect(envelope(ctx, at, level, 0.005, 0.12)).connect(out);
  osc.start(at);
  osc.stop(at + 0.2);
}

/** Two detuned saws behind a low-pass: a soft buzz. */
function buzz(ctx: BaseAudioContext, out: AudioNode, at: number, freq: number) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  filter.connect(envelope(ctx, at, 0.26, 0.01, 0.16)).connect(out);
  for (const detune of [-7, 7]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(at);
    osc.stop(at + 0.22);
  }
}

/** A tiny metal tap; partials above what the sample rate holds are left out. */
function tink(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  level: number,
  click: number,
) {
  burst(ctx, out, at, { freq: 6000, q: 3, level: click, decay: 0.008 });
  const partials = metal.filter(([ratio]) => freq * ratio < ctx.sampleRate / 2);
  bell(ctx, out, at, freq, partials, level);
  tone(ctx, out, at, freq * 1.006, level * 0.3, 0.25);
}

const glass: Partials = [
  [1, 1, 1.1],
  [2.32, 0.28, 0.45],
  [4.25, 0.1, 0.2],
];
const heldGlass: Partials = [
  [1, 1, 1.6],
  [2.32, 0.25, 0.5],
  [4.25, 0.08, 0.2],
];
const marimba: Partials = [
  [1, 1, 0.38],
  [3.99, 0.18, 0.06],
  [10.1, 0.04, 0.02],
];
const chime: Partials = [
  [1, 1, 1.5],
  [2.76, 0.35, 0.7],
  [5.4, 0.15, 0.35],
  [8.93, 0.06, 0.18],
];
const kalimba: Partials = [
  [1, 1, 0.55],
  [5.4, 0.08, 0.05],
];
const heldKalimba: Partials = [
  [1, 1, 0.9],
  [5.4, 0.08, 0.05],
];
const metal: Partials = [
  [1, 1, 0.28],
  [2.9, 0.4, 0.12],
  [5.1, 0.2, 0.06],
  [7.8, 0.1, 0.04],
];

const note = {
  D4: 293.7,
  G4: 392,
  A4: 440,
  D5: 587.3,
  F5: 698.5,
  G5: 784,
  A5: 880,
  Bb5: 932.3,
  C6: 1046.5,
  D6: 1174.7,
  E6: 1318.5,
  G6: 1568,
  A6: 1760,
  B6: 1975.5,
};

function kalimbaNote(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  level: number,
  partials = kalimba,
) {
  burst(ctx, out, at, { freq: freq * 2, q: 4, level: 0.06, decay: 0.01 });
  bell(ctx, out, at, freq, partials, level);
}

export const synths: Record<BuiltInSoundId, Play> = {
  // Done
  marimba: (c, o, t) => {
    bell(c, o, t, note.G5, marimba, 0.38);
    bell(c, o, t + 0.11, note.C6, marimba, 0.34);
  },
  glass: (c, o, t) => {
    bell(c, o, t, note.E6, glass, 0.22);
    bell(c, o, t + 0.09, note.B6, glass, 0.18);
  },
  kalimba: (c, o, t) => {
    kalimbaNote(c, o, t, note.C6, 0.26);
    kalimbaNote(c, o, t + 0.07, note.E6, 0.23);
    kalimbaNote(c, o, t + 0.14, note.G6, 0.2);
  },
  chime: (c, o, t) => bell(c, o, t, note.A5, chime, 0.32),
  pluck: (c, o, t) => {
    pluck(c, o, t, note.D5, 0.45, 500);
    pluck(c, o, t + 0.1, note.A5, 0.45, 500);
  },
  bubble: (c, o, t) => {
    pop(c, o, t, 420, 1300, 0.5);
    pop(c, o, t + 0.09, 620, 1800, 0.34);
  },
  ratchet: (c, o, t) => {
    for (const d of [0, 0.075]) {
      burst(c, o, t + d, { freq: 3200, q: 2, level: 0.75, decay: 0.018 });
      tone(c, o, t + d, 1850, 0.12, 0.04);
    }
    bell(c, o, t + 0.16, note.E6, glass, 0.2);
  },
  tink: (c, o, t) => tink(c, o, t, 2650, 0.45, 0.35),
  // Needs you
  "marimba-nudge": (c, o, t) => {
    bell(c, o, t, note.G5, marimba, 0.34);
    bell(c, o, t + 0.11, note.Bb5, marimba, 0.36);
    bell(c, o, t + 0.21, note.Bb5, marimba, 0.2);
  },
  ask: (c, o, t) => {
    bell(c, o, t, note.A5, glass, 0.2);
    bell(c, o, t + 0.12, note.C6, heldGlass, 0.22);
  },
  "kalimba-hang": (c, o, t) => {
    kalimbaNote(c, o, t, note.C6, 0.26);
    kalimbaNote(c, o, t + 0.08, note.E6, 0.23);
    kalimbaNote(c, o, t + 0.2, note.D6, 0.26, heldKalimba);
  },
  "double-ping": (c, o, t) => {
    bell(c, o, t, note.A6, chime, 0.24);
    bell(c, o, t + 0.17, note.A6, chime, 0.15);
  },
  "pluck-ask": (c, o, t) => {
    pluck(c, o, t, note.D5, 0.45, 600);
    pluck(c, o, t + 0.11, note.F5, 0.8, 600);
  },
  knock: (c, o, t) => {
    [0, 0.15].forEach((d, i) => {
      burst(c, o, t + d, {
        freq: 700,
        q: 1.2,
        type: "lowpass",
        level: 0.7 - i * 0.15,
        decay: 0.05,
      });
      tone(c, o, t + d, 150, 0.45 - i * 0.1, 0.09);
    });
  },
  "tap-tap": (c, o, t) => {
    for (const d of [0, 0.11]) {
      burst(c, o, t + d, { freq: 2400, q: 5, level: 0.8, decay: 0.03 });
      tone(c, o, t + d, 1250, 0.4, 0.06);
    }
  },
  "tink-tink": (c, o, t) => {
    tink(c, o, t, 2650, 0.28, 0.22);
    tink(c, o, t + 0.12, 3150, 0.24, 0.22);
  },
  // Failed or stopped
  fall: (c, o, t) => {
    bell(c, o, t, note.G5, marimba, 0.34);
    bell(c, o, t + 0.12, note.D5, marimba, 0.36);
  },
  thud: (c, o, t) => {
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(65, t + 0.2);
    osc.connect(envelope(c, t, 0.9, 0.004, 0.25)).connect(o);
    osc.start(t);
    osc.stop(t + 0.3);
    burst(c, o, t, { freq: 500, type: "lowpass", level: 0.35, decay: 0.06 });
  },
  "muted-buzz": (c, o, t) => {
    buzz(c, o, t, note.A4);
    buzz(c, o, t + 0.13, note.G4);
  },
};

/** Evens out the sounds' peaks so none clips and quiet ones still carry. */
export function soundOutput(ctx: BaseAudioContext, destination: AudioNode) {
  const squeeze = ctx.createDynamicsCompressor();
  squeeze.threshold.value = -14;
  squeeze.ratio.value = 4;
  squeeze.attack.value = 0.002;
  squeeze.release.value = 0.1;
  squeeze.connect(destination);
  return squeeze;
}
