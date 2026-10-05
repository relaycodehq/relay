/**
 * Kyutai's text preparation and sentence chunking (pocket_tts/models/text_chunking.py),
 * for the english_2026-04 settings: no space padding, semicolons kept.
 *
 * Two changes from the reference, both about where a sentence may end:
 * - a sentence mark only ends a sentence when the next word starts after a
 *   space, so `turn-run.ts` and `0.7.1` stay whole (the reference checks
 *   decimals only);
 * - a clause still longer than `maxTokens` is cut between words. The
 *   reference passes it on with a warning that words may be skipped, and a
 *   long enough one would run past the model's 1000-position cache.
 */
import type { SentencePiece } from "./tokenizer";

const terminal = ".!?…";
const weak = ",;:-–—";
const closers = "\"'”’)]»";
const wordStart = "▁";

export interface PreparedText {
  text: string;
  /** Frames the model keeps generating after it signals the end, so the last word isn't cut. */
  framesAfterEos: number;
}

export function prepareText(raw: string): PreparedText | null {
  let text = raw.trim();
  if (!text) return null;
  text = text.replaceAll("\n", " ").replaceAll("\r", " ").replaceAll("  ", " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  const first = String.fromCodePoint(text.codePointAt(0)!);
  text = first.toUpperCase() + text.slice(first.length);
  // The reference adds 2 to its guess before generating.
  return {
    text: ensureTerminalPunctuation(text),
    framesAfterEos: (words <= 4 ? 3 : 1) + 2,
  };
}

/** The model is trained on finished sentences; without a final mark the last word is often repeated. */
function ensureTerminalPunctuation(text: string) {
  const core = trimEnd(text, closers + " ");
  const tail = text.slice(core.length).trim();
  if (!core || terminal.includes(core.at(-1)!)) return text;
  if (weak.includes(core.at(-1)!))
    return trimEnd(core, weak + " ") + "." + tail;
  return text + ".";
}

function trimEnd(text: string, chars: string) {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

interface Segment {
  tokens: number;
  text: string;
}

/** Splits text into chunks of whole sentences of at most `maxTokens` tokens each, where possible. */
export function splitIntoChunks(
  tokenizer: SentencePiece,
  raw: string,
  maxTokens: number,
): string[] {
  const prepared = prepareText(raw);
  if (!prepared) return [];
  const sentenceEnds = new Set(tokenizer.encode(".!...?").slice(1));
  const clauseEnds = new Set(tokenizer.encode(",;:").slice(1));
  const sentences = segments(
    tokenizer,
    tokenizer.encode(prepared.text.trim()),
    sentenceEnds,
  );

  const pieces: Segment[] = [];
  for (const sentence of sentences) {
    if (sentence.tokens <= maxTokens) {
      pieces.push(sentence);
      continue;
    }
    const clauses = segments(
      tokenizer,
      tokenizer.encode(sentence.text.trim()),
      clauseEnds,
    );
    for (const clause of clauses.length > 1 ? clauses : [sentence]) {
      if (clause.tokens <= maxTokens) pieces.push(clause);
      else pieces.push(...betweenWords(tokenizer, clause.text, maxTokens));
    }
  }

  const chunks: string[] = [];
  let current = "";
  let count = 0;
  for (const piece of pieces) {
    if (current && count + piece.tokens <= maxTokens) {
      current += " " + piece.text;
      count += piece.tokens;
      continue;
    }
    if (current) chunks.push(current.trim());
    current = piece.text;
    count = piece.tokens;
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

/** Cuts after each run of `ends`, before the next token that starts a word. */
function segments(
  tokenizer: SentencePiece,
  tokens: number[],
  ends: Set<number>,
): Segment[] {
  const starts = [0];
  let afterEnd = false;
  tokens.forEach((token, i) => {
    if (ends.has(token)) {
      afterEnd = true;
      return;
    }
    const piece = tokenizer.piece(token);
    if (afterEnd && piece.startsWith(wordStart)) {
      starts.push(i);
      afterEnd = false;
    } else if (/[\p{L}\p{N}]/u.test(piece)) {
      // A closing quote or bracket may follow the mark; a letter or digit means it was inside a word.
      afterEnd = false;
    }
  });
  starts.push(tokens.length);
  const result: Segment[] = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const part = tokens.slice(starts[i], starts[i + 1]);
    result.push({ tokens: part.length, text: tokenizer.decode(part) });
  }
  return result;
}

function betweenWords(
  tokenizer: SentencePiece,
  text: string,
  maxTokens: number,
): Segment[] {
  const tokens = tokenizer.encode(text.trim());
  const result: Segment[] = [];
  let start = 0;
  while (tokens.length - start > maxTokens) {
    let cut = start + maxTokens;
    while (
      cut > start + 1 &&
      !tokenizer.piece(tokens[cut]).startsWith(wordStart)
    )
      cut--;
    if (cut === start + 1) cut = start + maxTokens;
    result.push({
      tokens: cut - start,
      text: tokenizer.decode(tokens.slice(start, cut)),
    });
    start = cut;
  }
  result.push({
    tokens: tokens.length - start,
    text: tokenizer.decode(tokens.slice(start)),
  });
  return result;
}
