/**
 * The revolver's click, made with Web Audio rather than shipped as a file: a
 * dry ratchet tick, a hard snap of filtered noise over a short woody ring.
 */
let context: AudioContext | undefined;
let output: AudioNode | undefined;
/** Audio time of the last click, so none sounds before the one it follows. */
let lastAt = 0;
/**
 * A turn's clicks are timed by the page clock from where the turn began, not
 * by the audio clock, which stands still for a moment as it wakes: timed by
 * it they'd bunch up. One that would sound in the past (a slow first frame, a
 * clock still waking) delays the rest of its turn by as much, so the spacing
 * between clicks holds.
 */
let turn: { wallMs: number; audio: number; delayMs: number } | undefined;
let lastWallMs = -Infinity;
/** A pause this long starts a new turn. */
const turnGapMs = 600;
let sleep: ReturnType<typeof setTimeout> | undefined;
/** A running context keeps an audio thread busy even in silence. */
const sleepAfterMs = 3000;

/** Level and punch; keeps a fast rattle from clipping. */
export function clickOutput(ctx: BaseAudioContext): AudioNode {
  const squeeze = ctx.createDynamicsCompressor();
  squeeze.threshold.value = -20;
  squeeze.ratio.value = 6;
  squeeze.attack.value = 0.001;
  squeeze.release.value = 0.06;
  const level = ctx.createGain();
  level.gain.value = 0.7;
  squeeze.connect(level).connect(ctx.destination);
  return squeeze;
}

function audio() {
  if (!context) {
    context = new AudioContext();
    output = clickOutput(context);
  }
  return { ctx: context, out: output! };
}

/**
 * Builds the audio engine before the first click is needed. Building it holds
 * up the page for a moment, which in the middle of a spin would show, so this
 * runs while idle; it then sleeps until a turn wakes it.
 */
export function warmClicks() {
  if (context) return;
  void audio().ctx.suspend();
}

/** Wakes the engine as a turn starts, so its clock runs by the first click. */
export function wakeClicks() {
  const { ctx } = audio();
  if (ctx.state !== "running") void ctx.resume();
  clearTimeout(sleep);
  sleep = setTimeout(() => void ctx.suspend(), sleepAfterMs);
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseOf(ctx: BaseAudioContext) {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

/** A burst of filtered noise: the snap of parts striking. */
function snap(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  o: { gain: number; decay: number; freq: number; q: number; type: BiquadFilterType },
) {
  const src = ctx.createBufferSource();
  src.buffer = noiseOf(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = o.type;
  filter.frequency.value = o.freq;
  filter.Q.value = o.q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(o.gain, t + 0.0004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
  src.connect(filter).connect(env).connect(out);
  src.start(t);
  src.stop(t + o.decay + 0.01);
}

/**
 * One ratchet tick into `out` at audio time `t`. `vary`, around 1, makes each
 * click a little different, as real parts are.
 */
export function tick(ctx: BaseAudioContext, out: AudioNode, t: number, vary: number) {
  snap(ctx, out, t, { gain: 1.3, decay: 0.008, freq: 3000 * vary, q: 1.6, type: "bandpass" });
  snap(ctx, out, t, { gain: 0.4, decay: 0.004, freq: 7000, q: 1, type: "highpass" });
  const ring = ctx.createOscillator();
  ring.frequency.value = 1850 * vary;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.26, t + 0.0005);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
  ring.connect(env).connect(out);
  ring.start(t);
  ring.stop(t + 0.02);
}

/** One chamber passing the pawl, sounding at `at` (a performance.now() time, or now). */
export function playClick(at = performance.now()) {
  wakeClicks();
  const { ctx, out } = audio();
  const now = performance.now();
  if (!turn || at - lastWallMs > turnGapMs)
    turn = { wallMs: now, audio: ctx.currentTime, delayMs: 0 };
  lastWallMs = at;
  // Behind the page clock, or behind where the audio clock has got to: late.
  const lateMs = Math.max(
    now - (at + turn.delayMs),
    (ctx.currentTime - turn.audio) * 1000 - (at + turn.delayMs - turn.wallMs),
  );
  if (lateMs > 0) turn.delayMs += lateMs;
  const t = Math.max(
    turn.audio + (at + turn.delayMs - turn.wallMs) / 1000,
    lastAt + 0.006,
  );
  lastAt = t;
  tick(ctx, out, t, 0.96 + Math.random() * 0.08);
}
