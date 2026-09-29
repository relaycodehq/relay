import { dictationSampleRate as rate } from "../../shared/dictation";

export interface SpeechEngine {
  /** Transcribes one phrase of 16 kHz samples. */
  decode(samples: Float32Array): Promise<string>;
  /** Feeds the voice detector; true while it hears speech. */
  detect(samples: Float32Array): boolean;
  resetDetector(): void;
}

export interface TranscriberOptions {
  /** Audio kept from before speech starts, so first syllables survive. */
  preroll?: number;
  /** A phrase this long is closed even without a pause, in seconds. */
  maxPhrase?: number;
  /** New audio needed before the open phrase is decoded again, in seconds. */
  partialStep?: number;
}

interface Phrase {
  chunks: Float32Array[];
  length: number;
  /** Samples covered by `text`. */
  decoded: number;
  text: string;
  closed: boolean;
  settled: boolean;
  /** Began where a long phrase was split, mid-sentence. */
  continued: boolean;
}

/**
 * Turns a live microphone stream into text that grows as you speak.
 *
 * Parakeet is not a streaming model, so the voice detector cuts speech into
 * phrases at pauses; the open phrase is decoded again whenever enough new
 * audio arrived (its words are tentative), and a closed phrase gets one last
 * decode that settles its text. Decodes run one at a time and settle phrases
 * in order, so settled text only ever grows.
 */
export class Transcriber {
  private phrases: Phrase[] = [];
  private preroll: Float32Array[] = [];
  private prerollLength = 0;
  private busy = false;
  private stopped = false;
  private drained: (() => void)[] = [];
  private readonly prerollSamples: number;
  private readonly maxPhrase: number;
  private readonly partialStep: number;

  constructor(
    private engine: SpeechEngine,
    private onText: (settled: string, tentative: string) => void,
    options: TranscriberOptions = {},
  ) {
    this.prerollSamples = (options.preroll ?? 0.4) * rate;
    this.maxPhrase = (options.maxPhrase ?? 15) * rate;
    this.partialStep = (options.partialStep ?? 0.3) * rate;
    engine.resetDetector();
  }

  push(samples: Float32Array) {
    if (this.stopped || !samples.length) return;
    const speaking = this.engine.detect(samples);
    const open = this.open();
    if (open) {
      open.chunks.push(samples);
      open.length += samples.length;
      if (!speaking) open.closed = true;
      else if (open.length >= this.maxPhrase) this.split(open);
    } else if (speaking) {
      this.begin([...this.preroll, samples]);
      this.preroll = [];
      this.prerollLength = 0;
    } else {
      this.preroll.push(samples);
      this.prerollLength += samples.length;
      while (this.prerollLength - this.preroll[0].length >= this.prerollSamples)
        this.prerollLength -= this.preroll.shift()!.length;
    }
    this.pump();
  }

  /** Settles everything heard so far and resolves with the whole text. */
  async stop() {
    this.stopped = true;
    const open = this.open();
    if (open) open.closed = true;
    this.pump();
    if (this.busy || this.phrases.some((p) => !p.settled))
      await new Promise<void>((resolve) => this.drained.push(resolve));
    return this.settledText();
  }

  private begin(chunks: Float32Array[], continued = false) {
    this.phrases.push({
      chunks,
      length: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
      decoded: 0,
      text: "",
      closed: false,
      settled: false,
      continued,
    });
  }

  /** Closes a phrase that ran on without a pause at its quietest recent moment, so no word is cut in half. */
  private split(phrase: Phrase) {
    const all = join(phrase.chunks, phrase.length),
      at = quietest(all, all.length - 1.5 * rate, all.length);
    phrase.chunks = [all.slice(0, at)];
    phrase.length = at;
    phrase.decoded = Math.min(phrase.decoded, at);
    phrase.closed = true;
    this.begin([all.slice(at)], true);
  }

  private open() {
    const last = this.phrases.at(-1);
    return last && !last.closed ? last : undefined;
  }

  private next(): { phrase: Phrase; final: boolean } | undefined {
    const unsettled = this.phrases.find((p) => !p.settled);
    if (!unsettled) return;
    if (unsettled.closed) return { phrase: unsettled, final: true };
    if (unsettled.length - unsettled.decoded >= this.partialStep)
      return { phrase: unsettled, final: false };
  }

  private pump() {
    if (this.busy) return;
    const job = this.next();
    if (!job) {
      if (this.stopped) for (const done of this.drained.splice(0)) done();
      return;
    }
    const { phrase, final } = job;
    const length = phrase.length,
      samples = pad(join(phrase.chunks, length), final);
    this.busy = true;
    this.engine
      .decode(samples)
      .then(
        (text) => {
          // Skip a partial that a split made reach past the phrase's end.
          if (final || length <= phrase.length) {
            phrase.text = text.trim();
            phrase.decoded = length;
          }
          if (final) {
            phrase.settled = true;
            phrase.chunks = [];
          }
        },
        () => {
          if (final) phrase.settled = true;
        },
      )
      .finally(() => {
        this.busy = false;
        this.emit();
        this.pump();
      });
  }

  private settledText() {
    return joinText(this.phrases.filter((p) => p.settled));
  }

  private emit() {
    const settled = this.phrases.filter((p) => p.settled),
      text = joinText(this.phrases),
      before = joinText(settled);
    this.onText(before, text.slice(before.length).trimStart());
  }
}

function join(chunks: Float32Array[], length: number) {
  const out = new Float32Array(length);
  let at = 0;
  for (const chunk of chunks) {
    if (at >= length) break;
    out.set(chunk.subarray(0, length - at), at);
    at += chunk.length;
  }
  return out;
}

/** Start of the quietest 100 ms window in [from, to). */
export function quietest(samples: Float32Array, from: number, to: number) {
  const size = 0.1 * rate,
    hop = size / 2;
  let best = Math.max(0, Math.floor(from)),
    lowest = Infinity;
  for (let at = best; at + size <= to; at += hop) {
    let energy = 0;
    for (let i = at; i < at + size; i++) energy += samples[i] * samples[i];
    if (energy < lowest) {
      lowest = energy;
      best = at;
    }
  }
  return best + hop;
}

/**
 * Parakeet drops a phrase's last word without some silence after it, and
 * guesses badly on clips under a second or so.
 */
function pad(samples: Float32Array, final: boolean) {
  const tail = final ? 0.3 * rate : 0.15 * rate,
    length = Math.max(samples.length + tail, 1.2 * rate),
    out = new Float32Array(length);
  out.set(samples);
  return out;
}

/** Joins phrases, fixing the capital letter each one starts with on its own. */
export function joinText(phrases: { text: string; continued?: boolean }[]) {
  let out = "";
  for (const { text, continued } of phrases) {
    if (!text) continue;
    if (!out) {
      out = text;
      continue;
    }
    const first = text.match(/^\p{L}+/u)?.[0] ?? "";
    let next = text;
    if (first && /[.!?…]["')\]]?$/.test(out))
      next = text.charAt(0).toUpperCase() + text.slice(1);
    else if (continued && first !== "I" && /^\p{Lu}\p{Ll}*$/u.test(first))
      next = text.charAt(0).toLowerCase() + text.slice(1);
    out += " " + next;
  }
  return out;
}
