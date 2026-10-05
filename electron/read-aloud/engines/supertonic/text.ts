// Text handling for Supertonic, ported from supertone-inc/supertonic nodejs/helper.js
// (MIT). The model reads Unicode characters directly, so there is no phonemizer.

export const supertonicLanguages = [
  "en",
  "ko",
  "ja",
  "ar",
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "et",
  "fi",
  "fr",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "lt",
  "lv",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "tr",
  "uk",
  "vi",
] as const;

/** A language the model was trained on, or "na" to read without one. */
export type SupertonicLanguage = (typeof supertonicLanguages)[number] | "na";

const emoji =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

const symbols: [string, string][] = [
  ["–", "-"],
  ["‑", "-"],
  ["—", "-"],
  ["_", " "],
  ["“", '"'],
  ["”", '"'],
  ["‘", "'"],
  ["’", "'"],
  ["´", "'"],
  ["`", "'"],
  ["[", " "],
  ["]", " "],
  ["|", " "],
  ["/", " "],
  ["#", " "],
  ["→", " "],
  ["←", " "],
];

const expressions: [string, string][] = [
  ["@", " at "],
  ["e.g.,", "for example, "],
  ["i.e.,", "that is, "],
];

/**
 * Normalizes `text` the way the reference implementation does and wraps it
 * in the language tags the model expects.
 */
export function preprocess(text: string, lang: SupertonicLanguage): string {
  text = text.normalize("NFKD").replace(emoji, "");
  for (const [from, to] of symbols) text = text.replaceAll(from, to);
  text = text.replace(/[♥☆♡©\\]/g, "");
  for (const [from, to] of expressions) text = text.replaceAll(from, to);
  text = text.replace(/ ([,.!?;:'])/g, "$1");
  text = text.replace(/"{2,}/g, '"').replace(/'{2,}/g, "'");
  text = text.replace(/\s+/g, " ").trim();
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(text)) text += ".";
  return `<${lang}>${text}</${lang}>`;
}

/**
 * Character ids for the model, one per UTF-16 code unit as the reference
 * indexes them. Characters the model has no id for are left out instead of
 * being sent as -1.
 */
export function textIds(processed: string, indexer: ArrayLike<number>) {
  const ids: number[] = [];
  for (const char of processed) {
    const id = indexer[char.charCodeAt(0)];
    if (id >= 0) ids.push(id);
  }
  return ids;
}

const sentenceEnd =
  /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/;

/** Paragraphs (split at blank lines), each cut into sentences. */
function paragraphs(text: string) {
  return text
    .trim()
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim().split(sentenceEnd).filter(Boolean))
    .filter((sentences) => sentences.length);
}

/** Packs whole sentences up to `maxLength` characters, never across paragraphs, like the reference. */
export function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  for (const sentences of paragraphs(text)) {
    let current = "";
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 <= maxLength) {
        current += (current ? " " : "") + sentence;
      } else {
        if (current) chunks.push(current.trim());
        current = sentence;
      }
    }
    if (current) chunks.push(current.trim());
  }
  return chunks;
}

/** Longest chunk the model reads well; Korean and Japanese pack more per character. */
export const maxChunkLength = (lang: SupertonicLanguage) =>
  lang === "ko" || lang === "ja" ? 120 : 300;

/**
 * Cuts text into the pieces `speak` synthesizes one after another. The first
 * is short so the first audio comes quickly (a long opening sentence is cut
 * at its first clause), and each next one may be twice as long as the last,
 * up to `maxChunkLength`: a chunk is made while the one before it plays, so
 * it must not take longer to make than that one takes to say.
 */
export function speechChunks(text: string, lang: SupertonicLanguage) {
  const max = maxChunkLength(lang);
  let limit = Math.min(max, 100);
  const chunks: string[] = [];
  const push = (chunk: string) => {
    chunks.push(chunk);
    limit = Math.min(max, Math.max(100, chunk.length * 2));
  };
  const all = paragraphs(text);
  const head = all.length ? openingCut(all[0]) : undefined;
  if (head) push(head);
  for (const sentences of all) {
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length + 1 > limit) {
        push(current);
        current = "";
      }
      if (sentence.length > limit) {
        for (const piece of splitLong(sentence, limit)) push(piece);
      } else {
        current += (current ? " " : "") + sentence;
      }
    }
    if (current) push(current);
  }
  return chunks;
}

const clauseMark = /[,;:](?= )| -(?= )/g;

/**
 * Takes the first clause off a long opening sentence (at least a few words,
 * at most 100 characters) and returns it, leaving the rest in `sentences`.
 */
function openingCut(sentences: string[]) {
  const [sentence] = sentences;
  if (sentence.length <= 60) return;
  for (const mark of sentence.matchAll(clauseMark)) {
    const end = mark.index + mark[0].length;
    if (end < 20) continue;
    if (end > 100) return;
    sentences[0] = sentence.slice(end).trim();
    return sentence.slice(0, end);
  }
}

/** Breaks one long sentence at a clause mark or a space into pieces of at most `max` characters. */
function splitLong(sentence: string, max: number) {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = -1;
    for (const mark of window.matchAll(clauseMark))
      cut = mark.index + mark[0].length;
    if (cut < max / 3) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Whether a chunk ends a sentence, so the next one starts after a full pause. */
export const endsSentence = (chunk: string) =>
  /[.!?…。]["')\]»”’]*$/.test(chunk);

const ones =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
    " ",
  );
const tens = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(
  " ",
);

/** English words for 0–999; longer numbers and leading zeros are read digit by digit. */
function numberWords(digits: string): string {
  if (digits.length > 3 || (digits.length > 1 && digits[0] === "0")) {
    return [...digits].map((d) => ones[Number(d)]).join(" ");
  }
  const n = Number(digits);
  if (n < 20) return ones[n];
  if (n < 100)
    return tens[Math.floor(n / 10)] + (n % 10 ? `-${ones[n % 10]}` : "");
  const rest = n % 100;
  return `${ones[Math.floor(n / 100)]} hundred${rest ? ` ${numberWords(String(rest))}` : ""}`;
}

/**
 * Spells out dotted versions like 0.7.1 in English words. The model reads
 * them unreliably as digits (the zero often goes missing) and reliably as
 * words; plain decimals it reads fine and are left alone.
 */
export function spellVersions(text: string) {
  return text.replace(/\bv?(\d+(?:\.\d+){2,})\b/g, (_, version: string) =>
    version.split(".").map(numberWords).join(" point "),
  );
}
