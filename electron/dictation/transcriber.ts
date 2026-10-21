import { dictationSampleRate as rate } from "../../shared/dictation";
import { afterSettled, collapseRepeats, SteadyWords } from "./steady";

export interface Word {
  text: string;
  /** Where it begins, in samples from the start of the clip. */
  at: number;
}

export interface Heard {
  text: string;
  /** The same text word by word, from an engine that can tell where each begins. */
  words?: Word[];
}

export interface SpeechEngine {
  /** Transcribes one phrase of 16 kHz samples. */
  decode(samples: Float32Array): Promise<Heard>;
}

export interface TranscriberOptions {
  /** Audio kept from before speech starts, so first syllables survive. */
  preroll?: number;
  /** Silence that ends a phrase, in seconds; shorter ones are thinking. */
  pause?: number;
  /** A phrase this long is closed even without a pause, in seconds. */
  maxPhrase?: number;
  /** New audio needed before the open phrase is decoded again, in seconds. */
  partialStep?: number;
  /** How far behind the live end words two decodes agree on are settled, in seconds. */
  settleBehind?: number;
}

interface Phrase {
  chunks: Float32Array[];
  length: number;
  /** Samples covered by `text`. */
  decoded: number;
  /** Samples up to the end of the last speech heard. */
  spoken: number;
  text: string;
  /** `text` word by word, when the engine tells where words begin. */
  words?: Word[];
  closed: boolean;
  settled: boolean;
  /** Began where a long phrase was split, mid-sentence. */
  continued: boolean;
  /** The settled words its start hears again, bare, to drop from what it's heard as. */
  heardAgain?: string[];
}

/**
 * Turns a live microphone stream into text that grows as you speak.
 *
 * Parakeet is not a streaming model, so speech is cut into phrases at long
 * pauses. Each phrase is decoded on its own, which ends it like a sentence, so
 * a pause to think must not cut one. The open phrase is decoded again whenever
 * enough new audio arrived (its words are tentative), and a closed phrase gets
 * one last decode that settles its text. Decodes run one at a time and settle phrases
 * in order, so settled text only ever grows.
 *
 * Talking fast leaves no pause to end a phrase, and each decode of a long one
 * guesses all its words afresh, so they keep changing. Words two decodes in a
 * row agree on, well behind the live end, are settled on the spot, and only
 * the rest is decoded again.
 */
export class Transcriber {
  private phrases: Phrase[] = [];
  private preroll: Float32Array[] = [];
  private prerollLength = 0;
  private busy = false;
  private stopped = false;
  private drained: (() => void)[] = [];
  private readonly prerollSamples: number;
  private readonly pause: number;
  private readonly maxPhrase: number;
  private readonly partialStep: number;
  private readonly settleBehind: number;
  /** How long the last partial decode took, in samples. */
  private lastPartial = 0;
  private steady = new SteadyWords();
  /** The settled text as last told, before repeats were dropped. */
  private told = "";

  constructor(
    private engine: SpeechEngine,
    private onText: (settled: string, tentative: string) => void,
    options: TranscriberOptions = {},
  ) {
    // Long, as the detector is slow to hear a whisper begin.
    this.prerollSamples = (options.preroll ?? 1) * rate;
    this.pause = (options.pause ?? 2) * rate;
    this.maxPhrase = (options.maxPhrase ?? 15) * rate;
    this.partialStep = (options.partialStep ?? 0.3) * rate;
    this.settleBehind = (options.settleBehind ?? 2) * rate;
  }

  /** The next stretch of audio, and whether the voice detector heard speech in it. */
  push(samples: Float32Array, speaking: boolean) {
    if (this.stopped || !samples.length) return;
    const open = this.open();
    if (open) {
      open.chunks.push(samples);
      open.length += samples.length;
      if (speaking) open.spoken = open.length;
      const silent = open.length - open.spoken;
      // Out of room in a pause: end it there, not on a split of silence.
      if (silent >= this.pause || (silent && open.length >= this.maxPhrase))
        this.close(open);
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
    if (open && hollow(open)) this.phrases.pop();
    else if (open) open.closed = true;
    this.pump();
    if (this.busy || this.phrases.some((p) => !p.settled))
      await new Promise<void>((resolve) => this.drained.push(resolve));
    return this.settledText();
  }

  /** `words` were already heard in this audio, by a decode of the phrase it was cut from. */
  private begin(chunks: Float32Array[], continued = false, words?: Word[]) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    this.phrases.push({
      chunks,
      length,
      decoded: 0,
      // A split can leave nothing but the pause after the last word.
      spoken: continued ? 0 : length,
      text: words ? wordsText(words) : "",
      words,
      closed: false,
      settled: false,
      continued,
    });
  }

  private close(phrase: Phrase) {
    // The detector is slow to hear speech again, so a word may already have
    // begun in the end of the pause. Hand that end to the next phrase rather
    // than cutting the word or hearing it twice.
    const all = join(phrase.chunks, phrase.length),
      cut = Math.max(phrase.spoken, all.length - this.prerollSamples);
    phrase.chunks = [all.slice(0, cut)];
    phrase.length = cut;
    phrase.decoded = Math.min(phrase.decoded, cut);
    phrase.closed = true;
    this.preroll = [all.slice(cut)];
    this.prerollLength = all.length - cut;
    if (hollow(phrase)) this.phrases.pop();
  }

  /** Closes a phrase that ran on without a pause at its quietest recent moment, so no word is cut in half. */
  private split(phrase: Phrase) {
    const all = join(phrase.chunks, phrase.length),
      at = quietest(all, all.length - 1.5 * rate, all.length);
    phrase.chunks = [all.slice(0, at)];
    phrase.length = at;
    phrase.decoded = Math.min(phrase.decoded, at);
    phrase.spoken = at;
    phrase.closed = true;
    // Until both halves are decoded again, the words heard so far stay on
    // screen, each in its half, instead of vanishing.
    const [head, tail] = cutWords(phrase.words, at);
    if (head) phrase.text = wordsText(head);
    this.begin([all.slice(at)], true, tail);
  }

  /**
   * Settles the open phrase's words up to the last one that `before` and
   * `now` agree on, well behind the live end, so they stop changing. The rest
   * goes on as a phrase of its own, from a little before those words end:
   * Parakeet's word times are a few words off when you talk fast, so the next
   * phrase hears the last of them again and drops them by their text.
   */
  private settle(phrase: Phrase, before: Word[], now: Word[]) {
    let agreed = 0;
    while (
      agreed < before.length &&
      agreed < now.length &&
      same(before[agreed]!, now[agreed]!)
    )
      agreed++;
    // The first word left unsettled must be agreed on too, as its time sets the cut.
    let next = agreed - 1;
    while (next > 0 && now[next]!.at > phrase.decoded - this.settleBehind)
      next--;
    const word = next > 0 ? now[next]!.at : 0;
    // Settling a sliver at a time would cut the audio up for little gain.
    if (word - overlap < minSettle) return;
    // Parakeet hears nothing at all in a clip that starts mid-word.
    const all = join(phrase.chunks, phrase.length),
      cut = quietest(
        all,
        word - overlap - 0.5 * rate,
        word - overlap + 0.3 * rate,
      ),
      settled = now.slice(0, next);
    phrase.text = wordsText(settled);
    phrase.words = undefined;
    phrase.chunks = [];
    phrase.closed = phrase.settled = true;
    this.begin(
      [all.slice(cut)],
      true,
      now.slice(next).map((w) => ({ ...w, at: w.at - cut })),
    );
    const rest = this.open()!;
    rest.spoken = Math.max(0, phrase.spoken - cut);
    rest.heardAgain = settled.slice(-16).map(bare);
  }

  private open() {
    const last = this.phrases.at(-1);
    return last && !last.closed ? last : undefined;
  }

  private next(): { phrase: Phrase; final: boolean } | undefined {
    const unsettled = this.phrases.find((p) => !p.settled);
    if (!unsettled) return;
    if (unsettled.closed) return { phrase: unsettled, final: true };
    // Nothing new to hear once a decode has caught up past the last word.
    const caughtUp = unsettled.decoded >= unsettled.spoken + this.partialStep;
    // Decoding again before as much audio came in as the last decode took
    // keeps the engine busy nonstop, and it falls further behind: a long
    // phrase takes longer to decode, and a busy computer longer still.
    const step = Math.max(this.partialStep, this.lastPartial);
    if (!caughtUp && unsettled.length - unsettled.decoded >= step)
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
      lead = phrase.continued ? leadIn : 0,
      samples = pad(join(phrase.chunks, length), final, lead);
    this.busy = true;
    const started = performance.now();
    this.engine
      .decode(samples)
      .then(
        (heard) => {
          if (!final)
            this.lastPartial = ((performance.now() - started) / 1000) * rate;
          // Skip a partial that a split made reach past the phrase's end.
          if (final || length <= phrase.length) {
            const before = phrase.words;
            if (lead && heard.words)
              heard = {
                ...heard,
                words: heard.words.map((w) => ({ ...w, at: w.at - lead })),
              };
            if (phrase.heardAgain && heard.words)
              heard = withoutRepeat(heard.words, phrase.heardAgain);
            phrase.decoded = length;
            // More audio holds as many words, but now and then Parakeet hears
            // most of a clip as nothing, or loses its start; keep the last
            // guess over that one. Dropping words it made up at the end is
            // a fix, though.
            const had = wordCount(phrase.text),
              has = wordCount(heard.text),
              lost =
                has < had - 1 &&
                has < had * 0.75 &&
                opening(heard.text) !== opening(phrase.text);
            if (!lost) {
              phrase.text = heard.text.trim();
              phrase.words = heard.words;
              if (!final && !phrase.closed && before && heard.words)
                this.settle(phrase, before, heard.words);
            }
          }
          if (final) {
            phrase.settled = true;
            phrase.chunks = [];
            phrase.words = undefined;
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
    return collapseRepeats(joinText(this.phrases.filter((p) => p.settled)));
  }

  private emit() {
    const text = joinText(this.phrases),
      before = joinText(this.phrases.filter((p) => p.settled)),
      shown = this.steady.next(
        text.slice(before.length).trimStart(),
        before.slice(this.told.length),
      ),
      settled = collapseRepeats(before);
    this.told = before;
    // Every decode ends its clip like a sentence; the mark comes back once
    // the words settle, if they end one.
    const tentative = afterSettled(settled, collapseRepeats(shown)).replace(
      /[.,?!…]+$/u,
      "",
    );
    this.onText(settled, tentative);
  }
}

/**
 * Split off after the last word, with nothing but the detector hanging on to
 * that word; Parakeet makes words up from such a clip of silence.
 */
const hollow = (phrase: Phrase) =>
  phrase.continued && phrase.spoken < 0.5 * rate && !phrase.text;

/**
 * Silence before a clip cut out of speech: Parakeet, at a loss with one that
 * starts mid-word, may hear none of it.
 */
const leadIn = 0.3 * rate;
/** Audio a settled phrase's successor hears again, in samples. */
const overlap = 1 * rate;
/** The least audio worth settling at once, in samples. */
const minSettle = 2 * rate;

const wordsText = (words: Word[]) => words.map((w) => w.text).join(" ");

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The first two words, bare. */
const opening = (text: string) =>
  text
    .split(/\s+/)
    .slice(0, 2)
    .map((t) => bare({ text: t, at: 0 }))
    .join(" ");

const bare = (word: Word) =>
  word.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** The same word, whatever punctuation and capital each decode gave it. */
const same = (a: Word, b: Word) => bare(a) === bare(b);

/**
 * `words` without the start that repeats the last of `settled`. Its first
 * word may come out clipped, so the repeat can start a word or two in.
 */
export function withoutRepeat(words: Word[], settled: string[]): Heard {
  const bareWords = words.map(bare),
    // Words that may still be in the audio heard again; the times run early.
    reach = words.filter((w) => w.at < overlap + rate).length;
  for (let length = Math.min(settled.length, reach); length; length--) {
    const tail = settled.slice(-length);
    // Short runs match by chance too easily anywhere but near the start.
    const latest = length > 2 ? reach - length : length > 1 ? 2 : 0;
    for (let at = 0; at <= latest; at++)
      if (tail.every((word, i) => bareWords[at + i] === word)) {
        const rest = words.slice(at + length);
        return { text: wordsText(rest), words: rest };
      }
  }
  // No repeat found: drop what the times say came before the overlap ended,
  // erring early, as they run early.
  const rest = words.filter((w) => w.at >= overlap - 0.5 * rate);
  return { text: wordsText(rest), words: rest };
}

/** Words before and from `at`, the second half moved to start there. */
function cutWords(words: Word[] | undefined, at: number) {
  if (!words) return [undefined, undefined] as const;
  const from = words.findIndex((w) => w.at >= at),
    split = from < 0 ? words.length : from;
  return [
    words.slice(0, split),
    words.slice(split).map((w) => ({ ...w, at: w.at - at })),
  ] as const;
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
function pad(samples: Float32Array, final: boolean, lead: number) {
  const tail = final ? 0.3 * rate : 0.15 * rate,
    length = Math.max(lead + samples.length + tail, 1.2 * rate),
    out = new Float32Array(length);
  out.set(samples, lead);
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
