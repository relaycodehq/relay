export type ModelPickerSearchable = {
  /** Which agent the row belongs to, as its id: "codex", "claude", "opencode", "cursor", "message". */
  driverKind: string;
  /** The agent's display name: "Codex", "Claude", "OpenCode", "Cursor", "No agent". */
  providerDisplayName: string;
  /** The model's display name: "GPT-5.5". */
  name: string;
  /** The model's id, e.g. "gpt-5.5" or "anthropic/claude-sonnet". */
  shortName?: string;
  /** Extra searchable text: a grouped agent's section name plus the description. */
  subProvider?: string;
  /** Raised for rows the user has starred. */
  isFavorite?: boolean;
};

/** Every fuzzy-only match scores at least this; the catalog drops them in long lists. */
export const fuzzyBase = 100;
const favoriteBoost = 24;
const fieldStep = 10;
const maxLengthPenalty = 64;
const boundaries = new Set([" ", "-", "_", "/"]);

const normalize = (value: string | undefined) =>
  (value ?? "").trim().toLowerCase();

/** The earliest place `word` starts right after a separator, or -1. */
function wordStart(field: string, word: string) {
  for (
    let at = field.indexOf(word, 1);
    at > 0;
    at = field.indexOf(word, at + 1)
  )
    if (boundaries.has(field[at - 1])) return at;
  return -1;
}

/** The word's characters in order, taken greedily: where it starts and how many it skips. */
function subsequence(field: string, word: string) {
  let first = -1;
  let at = -1;
  for (const char of word) {
    at = field.indexOf(char, at + 1);
    if (at < 0) return null;
    if (first < 0) first = at;
  }
  return { first, skipped: at - first + 1 - word.length };
}

function scoreField(field: string, word: string, base: number) {
  if (!field || !word) return null;
  if (field === word) return base;
  const penalty = Math.min(maxLengthPenalty, field.length - word.length);
  if (field.startsWith(word)) return base + 2 + penalty;
  const start = wordStart(field, word);
  if (start >= 0) return base + 4 + 2 * start + penalty;
  const inside = field.indexOf(word);
  if (inside >= 0) return base + 6 + 2 * inside + penalty;
  if (word.length < 3) return null;
  const fuzzy = subsequence(field, word);
  if (!fuzzy) return null;
  return base + fuzzyBase + 2 * fuzzy.first + 4 * fuzzy.skipped + penalty;
}

/**
 * How well one picker row matches a typed query; lower is better and null is
 * no match. Every word has to match some field, and the row's score is the
 * sum of each word's best one.
 */
export function rankModelQuery(
  model: ModelPickerSearchable,
  query: string,
): number | null {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;

  const values = [
    model.name,
    model.shortName,
    model.subProvider,
    model.driverKind,
    model.providerDisplayName,
  ]
    .map(normalize)
    .filter(Boolean);
  // A field's weight is its place among the fields the row has, so a row
  // without an id moves its later fields up a step.
  const fields = [...values, values.join(" ")].filter(Boolean);

  let total = 0;
  for (const word of words) {
    let best: number | null = null;
    fields.forEach((field, i) => {
      const score = scoreField(field, word, i * fieldStep);
      if (score !== null && (best === null || score < best)) best = score;
    });
    if (best === null) return null;
    total += best;
  }
  return model.isFavorite ? total - favoriteBoost : total;
}
