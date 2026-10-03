import { hash } from "./math";
import { ACTIVITY } from "./scenes/activity";
import { FINALE } from "./scenes/finale";
import { HANDOFF } from "./scenes/handoff";
import { PULLS } from "./scenes/pulls";
import { REVIEW, REVIEWERS } from "./scenes/review";
import { SENT, SWITCHES, PRESETS } from "./scenes/switcher";
import { AT, DURATION } from "./story";

const RATE = 48000;
const LEVEL = 1.5;
const SEMITONES: Record<string, number> = {
  C: -9, "C#": -8, D: -7, "D#": -6, E: -5, F: -4, "F#": -3, G: -2, "G#": -1, A: 0, "A#": 1, B: 2,
};

/** "F#4" as a frequency. */
function hz(note: string) {
  const octave = Number(note.slice(-1));
  return 440 * Math.pow(2, (SEMITONES[note.slice(0, -1)] + (octave - 4) * 12) / 12);
}

/** The harmony under each part of the day: when, the bass, the pad, how open. */
const CHORDS: [number, string, string[], number, number][] = [
  [0, "D2", ["A2", "D3", "F#3", "A3", "C#4", "E4"], 1150, 1],
  [AT.switcher - 0.4, "B1", ["F#2", "B2", "D3", "F#3", "A3", "C#4"], 1250, 0.95],
  [AT.review - 0.4, "G1", ["G2", "D3", "G3", "B3", "D4", "F#4"], 1350, 1],
  [AT.pulls - 0.4, "E2", ["B2", "E3", "G3", "B3", "D4", "F#4"], 1500, 1],
  [AT.source - 0.4, "B1", ["F#2", "B2", "D3", "F#3", "C#4"], 820, 0.8],
  [55.0, "G1", ["D3", "G3", "B3", "C#4", "F#4"], 620, 0.6],
  [AT.finale + FINALE.tied - 0.5, "D2", ["A2", "D3", "F#3", "A3", "C#4", "E4", "F#4"], 1700, 1.15],
];

/** A day's light in the major pentatonic: what the small sounds are tuned to. */
const SCALE = ["D5", "E5", "F#5", "A5", "B5", "D6", "E6", "F#6"];

class Score {
  private readonly out: GainNode;
  private readonly wet: GainNode;
  private readonly noise: AudioBuffer;

  constructor(private readonly ctx: BaseAudioContext) {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, 0);
    master.gain.linearRampToValueAtTime(LEVEL, 1.6);
    const end = AT.finale + FINALE.black[0];
    master.gain.setValueAtTime(LEVEL, end - 0.2);
    master.gain.linearRampToValueAtTime(0, end + 0.9);
    const squeeze = ctx.createDynamicsCompressor();
    squeeze.threshold.value = -18;
    squeeze.ratio.value = 3;
    squeeze.attack.value = 0.02;
    squeeze.release.value = 0.3;
    // Then a ceiling, so the thumps can't clip.
    const ceiling = ctx.createDynamicsCompressor();
    ceiling.threshold.value = -6;
    ceiling.knee.value = 3;
    ceiling.ratio.value = 16;
    ceiling.attack.value = 0.002;
    ceiling.release.value = 0.12;
    // The compressors add their own make-up gain; this leaves headroom after it.
    const trim = ctx.createGain();
    trim.gain.value = 0.82;
    master.connect(squeeze).connect(ceiling).connect(trim).connect(ctx.destination);
    this.out = master;

    this.noise = ctx.createBuffer(1, RATE * 2, RATE);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = hash(i * 0.731 + 5) * 2 - 1;

    // A room: three and a half seconds of dark, decaying noise.
    const room = ctx.createBuffer(2, RATE * 3.5, RATE);
    for (let channel = 0; channel < 2; channel++) {
      const data = room.getChannelData(channel);
      let smoothed = 0;
      for (let i = 0; i < data.length; i++) {
        const k = i / data.length;
        const raw = hash(i * 1.317 + channel * 911.3) * 2 - 1;
        smoothed += (raw - smoothed) * (0.5 - 0.38 * k);
        data[i] = smoothed * Math.pow(1 - k, 2.4) * (i < 400 ? i / 400 : 1);
      }
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = room;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.7;
    this.wet.connect(reverb).connect(master);
  }

  private send(node: AudioNode, dry: number, wet: number, pan = 0) {
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    node.connect(panner);
    const direct = this.ctx.createGain();
    direct.gain.value = dry;
    panner.connect(direct).connect(this.out);
    const sent = this.ctx.createGain();
    sent.gain.value = wet;
    panner.connect(sent).connect(this.wet);
  }

  /** Detuned saws under a slow filter, one chord at a time, overlapping. */
  pad() {
    const { ctx } = this;
    CHORDS.forEach(([at, bass, notes, cutoff, level], i) => {
      const until = i + 1 < CHORDS.length ? CHORDS[i + 1][0] + 2.6 : DURATION + 1;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.4;
      filter.frequency.setValueAtTime(cutoff * 0.55, at);
      filter.frequency.linearRampToValueAtTime(cutoff, at + 4);
      filter.frequency.linearRampToValueAtTime(cutoff * 0.75, until);
      const body = ctx.createGain();
      body.gain.setValueAtTime(0, at);
      body.gain.linearRampToValueAtTime(level, at + 2.4);
      body.gain.setValueAtTime(level, until - 2.6);
      body.gain.linearRampToValueAtTime(0, until);
      filter.connect(body);
      this.send(body, 0.8, 0.5);
      notes.forEach((note, n) => {
        for (const cents of [-7, 6]) {
          const osc = ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.value = hz(note);
          osc.detune.value = cents + (n % 2 ? 3 : -3);
          const gain = ctx.createGain();
          gain.gain.value = 0.03;
          osc.connect(gain).connect(filter);
          osc.start(at);
          osc.stop(until);
        }
      });
      const sub = ctx.createOscillator();
      sub.frequency.value = hz(bass);
      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0, at);
      subGain.gain.linearRampToValueAtTime(0.07 * level, at + 2.4);
      subGain.gain.setValueAtTime(0.07 * level, until - 2.6);
      subGain.gain.linearRampToValueAtTime(0, until);
      sub.connect(subGain).connect(this.out);
      sub.start(at);
      sub.stop(until);
    });
  }

  /** A soft mallet: a sine, a quieter octave, a fast fall. */
  pluck(at: number, note: string, amount = 0.12, pan = 0, decay = 1.1) {
    const level = amount * 1.7;
    const { ctx } = this;
    const f = hz(note);
    const body = ctx.createGain();
    body.gain.setValueAtTime(0, at);
    body.gain.linearRampToValueAtTime(level, at + 0.006);
    body.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    for (const [ratio, amount, type] of [
      [1, 1, "sine"],
      [2.005, 0.28, "sine"],
      [0.5, 0.2, "triangle"],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * ratio;
      const gain = ctx.createGain();
      gain.gain.value = amount;
      osc.connect(gain).connect(body);
      osc.start(at);
      osc.stop(at + decay + 0.05);
    }
    this.send(body, 0.7, 0.6, pan);
  }

  private burst(at: number, length: number, type: BiquadFilterType, frequency: number, q: number, level: number, pan = 0, wet = 0.15) {
    const { ctx } = this;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain);
    this.send(gain, 1, wet, pan);
    source.start(at, (at * 0.37) % 1.5);
    source.stop(at + length + 0.02);
  }

  /** A key, a chip, a row: the smallest sound. */
  tick(at: number, level = 0.05, pan = 0) {
    this.burst(at, 0.03, "highpass", 3200, 0.7, level, pan);
  }

  /** The drum's detent: something mechanical falling into place. */
  detent(at: number, pan = 0) {
    const { ctx } = this;
    this.burst(at, 0.05, "bandpass", 950, 3, 0.3, pan);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(230, at);
    osc.frequency.exponentialRampToValueAtTime(150, at + 0.05);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    osc.connect(gain);
    this.send(gain, 1, 0.1, pan);
    osc.start(at);
    osc.stop(at + 0.1);
  }

  thump(at: number, level = 0.4) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(92, at);
    osc.frequency.exponentialRampToValueAtTime(40, at + 0.32);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    osc.connect(gain);
    this.send(gain, 1, 0.25);
    osc.start(at);
    osc.stop(at + 0.55);
  }

  /** Air moving: filtered noise that sweeps as the ribbon goes by. */
  whoosh(from: number, to: number, sweep: [number, number, number], level: number, pans: [number, number] = [0, 0]) {
    const { ctx } = this;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.9;
    const mid = (from + to) / 2;
    filter.frequency.setValueAtTime(sweep[0], from);
    filter.frequency.exponentialRampToValueAtTime(sweep[1], mid);
    filter.frequency.exponentialRampToValueAtTime(sweep[2], to);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, from);
    gain.gain.linearRampToValueAtTime(level, from + (to - from) * 0.42);
    gain.gain.linearRampToValueAtTime(0, to);
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pans[0], from);
    panner.pan.linearRampToValueAtTime(pans[1], to);
    source.connect(filter).connect(gain).connect(panner);
    this.send(panner, 0.8, 0.5);
    source.start(from);
    source.stop(to + 0.05);
  }

  /** One reviewer thinking: a held tone with a slow waver. */
  voice(from: number, to: number, note: string, pan: number, level = 0.03) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = hz(note);
    const waver = ctx.createOscillator();
    waver.frequency.value = 4.2 + pan;
    const depth = ctx.createGain();
    depth.gain.value = 2.4;
    waver.connect(depth).connect(osc.frequency);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, from);
    gain.gain.linearRampToValueAtTime(level, from + 0.7);
    gain.gain.setValueAtTime(level, to - 0.25);
    gain.gain.linearRampToValueAtTime(0, to + 0.35);
    osc.connect(gain);
    this.send(gain, 0.7, 0.7, pan);
    for (const o of [osc, waver]) {
      o.start(from);
      o.stop(to + 0.4);
    }
  }

  /** The thread-finished motif: it comes back when the Mac mini is done. */
  done(at: number, level = 0.13) {
    this.pluck(at, "A5", level, 0.15, 1.3);
    this.pluck(at + 0.11, "D6", level, -0.1, 1.8);
  }
}

function compose(ctx: BaseAudioContext) {
  const s = new Score(ctx);
  s.pad();

  // The ribbon comes in.
  s.whoosh(0.1, 3.4, [180, 620, 300], 0.16, [-0.5, 0.3]);
  s.whoosh(3.6, 5.6, [300, 900, 500], 0.07, [0, -0.3]);

  // Activity: the cards, one finishing, ⌘ held, the pick.
  const a = AT.activity;
  for (let i = 0; i < 6; i++) s.pluck(a - 0.6 + i * 0.1, SCALE[i], 0.035, -0.5 + i * 0.06, 0.7);
  s.done(a + ACTIVITY.finished);
  for (let i = 0; i < 6; i++) s.tick(a + ACTIVITY.held[0] + i * 0.05, 0.035, -0.5);
  s.detent(a + ACTIVITY.picked, -0.4);
  s.pluck(a + ACTIVITY.picked, "F#5", 0.07, -0.4, 0.9);
  s.whoosh(13.4, 15.6, [260, 780, 420], 0.07, [-0.4, 0.3]);

  // Quick switch: keys, then the drum.
  const q = AT.switcher;
  for (let i = 0; i < 26; i++) {
    const at = q + 0.45 + i * 0.079 + hash(i * 9.1) * 0.03;
    s.tick(at, 0.016 + hash(i * 3.3) * 0.014, -0.15 + hash(i * 5.7) * 0.3);
  }
  for (const { at, preset } of SWITCHES) {
    s.detent(q + at, -0.25);
    s.pluck(q + at + 0.01, SCALE[Math.max(0, PRESETS.indexOf(preset) - 2)], 0.085, -0.2, 0.75);
  }
  s.thump(q + SENT, 0.3);
  s.whoosh(q + SENT - 0.1, q + SENT + 1.9, [240, 1500, 380], 0.14, [0.2, 0.6]);

  // Deep review: four voices, done one by one, then the lead's findings and the fixes.
  const r = AT.review;
  const parts = ["D4", "F#4", "A4", "B4"];
  REVIEWERS.forEach((reviewer, i) => {
    const pan = -0.6 + i * 0.4;
    s.voice(r + reviewer.calls[0][0], r + reviewer.done, parts[i], pan);
    for (const [at] of reviewer.calls) s.tick(r + at, 0.022, pan);
    s.pluck(r + reviewer.done, parts[i].replace("4", "5"), 0.06, pan, 0.9);
  });
  s.whoosh(r + REVIEW.handover - 0.3, r + REVIEW.report + 0.3, [300, 1100, 600], 0.06);
  for (let i = 0; i < 5; i++) s.pluck(r + REVIEW.report + 1.0 + i * 0.12, SCALE[5 - i], 0.05, 0.1, 0.6);
  s.detent(r + REVIEW.fix, 0.3);
  for (let i = 0; i < 5; i++) s.pluck(r + REVIEW.fixed(i), SCALE[i + 1], 0.085, 0.25, 1.0);
  s.whoosh(r + REVIEW.leave - 0.6, r + REVIEW.leave + 1.4, [260, 900, 420], 0.07, [0.2, 0.6]);

  // Pull requests: tiles, then the verdict.
  const p = AT.pulls;
  for (let i = 0; i < 3; i++) s.tick(p + 0.35 + i * 0.1, 0.03, -0.3 + i * 0.2);
  s.pluck(p + PULLS.approved, "B5", 0.1, -0.1, 1.2);
  s.pluck(p + PULLS.approved + 0.12, "E6", 0.1, 0.1, 1.6);
  s.whoosh(42.3, 44.0, [240, 700, 360], 0.06, [-0.2, 0.3]);

  // The handoff: the menu, the pick, the note, then away.
  const h = AT.source;
  s.tick(h + HANDOFF.menu, 0.05, 0.4);
  s.tick(h + HANDOFF.aim, 0.035, 0.4);
  s.detent(h + HANDOFF.pick, 0.4);
  s.pluck(h + HANDOFF.pick, "F#5", 0.07, 0.4, 1.2);
  s.pluck(h + HANDOFF.noted, "C#5", 0.06, 0.1, 1.4);
  s.thump(h + HANDOFF.sent + 0.1, 0.34);
  s.whoosh(h + HANDOFF.sent, AT.landed + 0.3, [200, 1700, 320], 0.2, [-0.6, 0.6]);
  s.thump(AT.landed, 0.3);
  s.pluck(AT.landed + 0.02, "B4", 0.09, 0.4, 1.8);
  s.pluck(AT.landed + 0.14, "F#5", 0.08, 0.5, 2.0);

  // Night, then the ribbon ties the R.
  const f = AT.finale;
  s.whoosh(57.0, f + 0.6, [220, 900, 500], 0.08, [0.3, 0.5]);
  s.whoosh(f + 0.2, f + FINALE.drawn + 0.3, [320, 1200, 520], 0.1, [0.2, 0]);
  ["D5", "A5", "F#5", "A5", "D6"].forEach((note, i) =>
    s.pluck(f + 0.5 + i * 0.86, note, 0.05, 0.1, 1.6),
  );
  s.thump(f + FINALE.tied + 0.05, 0.22);
  for (const [i, note] of ["D5", "A5", "F#6"].entries())
    s.pluck(f + FINALE.crisp[0] + 0.05 + i * 0.07, note, 0.11, -0.1 + i * 0.1, 3.2);
  s.tick(f + FINALE.working, 0.03);
  s.done(f + FINALE.finished, 0.14);
  s.detent(f + FINALE.bring);
  s.whoosh(f + FINALE.bring, f + FINALE.bring + 1.3, [900, 500, 200], 0.1, [0.3, -0.5]);
}

/** The whole score as audio, the same every time it's rendered. */
export async function renderScore(): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * DURATION), RATE);
  compose(ctx);
  return ctx.startRendering();
}

/** A rendered score as a 16-bit WAV file. */
export function wav(buffer: AudioBuffer): Uint8Array {
  const frames = buffer.length;
  const channels = buffer.numberOfChannels;
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      at += 2;
    }
  return bytes;
}
