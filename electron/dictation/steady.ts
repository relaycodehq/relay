const bare = (word: string) =>
  word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

const split = (text: string) => text.split(/\s+/).filter(Boolean);

/** Punctuation a word ends with. */
const mark = (word: string) => word.match(/[^\p{L}\p{N}']+$/u)?.[0] ?? "";

/**
 * Drops a word said twice in a row ("how how"), keeping the punctuation the
 * repeat ended with. Only ever drops the later one, so text that grows at the
 * end keeps its start.
 */
export function collapseRepeats(text: string) {
  const out: string[] = [];
  for (const word of split(text)) {
    const last = out.at(-1);
    if (last !== undefined && bare(word) && bare(word) === bare(last)) {
      if (!mark(last)) out[out.length - 1] = last + mark(word);
      continue;
    }
    out.push(word);
  }
  return out.join(" ");
}

/** `tentative` without a first word that repeats the last settled one. */
export function afterSettled(settled: string, tentative: string) {
  const last = split(settled).at(-1),
    [first, ...rest] = split(tentative);
  return last && first && bare(first) === bare(last)
    ? rest.join(" ")
    : tentative;
}

/**
 * The longest run of words `a` and `b` share in order: for each word of `b`
 * in it, the index of its match in `a`, and where in each the run ends.
 */
export function aligned(a: string[], b: string[]) {
  const rows = a.length + 1,
    cols = b.length + 1,
    table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] =
        bare(a[i]!) === bare(b[j]!)
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
  let i = 0,
    j = 0,
    end = { a: 0, b: 0 };
  const match = new Map<number, number>();
  while (i < a.length && j < b.length) {
    if (bare(a[i]!) === bare(b[j]!)) {
      match.set(j, i);
      end = { a: ++i, b: ++j };
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) i++;
    else j++;
  }
  return { ...end, match };
}

/**
 * The tentative words as shown. Each decode guesses them afresh, so on
 * screen they'd flip back and forth ("much better", "better", "much better").
 * Words already shown change only once two decodes in a row agree on it;
 * new words at the end show at once.
 */
export class SteadyWords {
  private shown: string[] = [];
  private last: string[] = [];

  /** `raw` is the latest tentative text; `settled`, words just settled off its start. */
  next(raw: string, settled: string) {
    if (settled) {
      const words = split(settled);
      this.shown = this.shown.slice(aligned(words, this.shown).b);
      this.last = this.last.slice(aligned(words, this.last).b);
    }
    const now = split(raw),
      // The last word of a decode may be cut off mid-word; the next one finishes it.
      known = this.last.slice(0, -1),
      agrees =
        known.length <= now.length &&
        known.every((word, i) => bare(word) === bare(now[i]!));
    // Otherwise the words both have stay as shown, and the end, where a
    // decode only guessed at a word cut off, follows the new one.
    const end = aligned(this.shown, now);
    this.shown = agrees
      ? // A comma or capital two decodes disagree on stays as shown, too.
        now.map((word, j) => {
          const was = end.match.get(j);
          return j < known.length && word !== known[j] && was !== undefined
            ? this.shown[was]!
            : word;
        })
      : [...this.shown.slice(0, end.a), ...now.slice(end.b)];
    this.last = now;
    return this.shown.join(" ");
  }
}
