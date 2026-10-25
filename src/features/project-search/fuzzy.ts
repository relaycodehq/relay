/** A path that matched the query, best first by `score`. */
export interface FuzzyMatch {
  path: string;
  score: number;
  /** Positions in `path` of the characters the query matched, ascending. */
  indices: number[];
}

/** What was typed in the Files box: the name part, and a line to jump to. */
export interface FileQuery {
  text: string;
  line?: number;
  /** 0-based, though typed 1-based as editors show it. */
  column?: number;
}

/** `Foo.tsx:42` and `Foo.tsx:42:7` name a line and a column; `:42` alone is a line in the current file. */
export function parseFileQuery(raw: string): FileQuery {
  const jump = /^(.*?)(?::(\d+)(?::(\d+))?)?:?$/.exec(raw.trim());
  const text = (jump?.[1] ?? raw).replace(/\\/g, "/").replace(/\s+/g, "");
  if (!jump?.[2]) return { text };
  return {
    text,
    line: Math.max(1, Number(jump[2])),
    ...(jump[3] ? { column: Math.max(0, Number(jump[3]) - 1) } : {}),
  };
}

const NEG = -1_000_000;
const base = 16;
const consecutive = 14;
const gapStart = 3;
const gapExtend = 1;
const inName = 6;

const isUpper = (c: number) => c >= 65 && c <= 90;
const isLower = (c: number) => c >= 97 && c <= 122;
const isDigit = (c: number) => c >= 48 && c <= 57;
const isWordChar = (c: number) =>
  isUpper(c) || isLower(c) || isDigit(c) || c > 127;

/** How much a match at `j` is worth for where it sits: a path start, after a slash or a dot, a camelCase hump. */
function positionBonus(path: string, j: number, nameStart: number) {
  if (j === 0) return 8;
  const prev = path.charCodeAt(j - 1);
  const c = path.charCodeAt(j);
  let bonus = 0;
  if (prev === 47) bonus = 12;
  else if (!isWordChar(prev)) bonus = 8;
  else if (isLower(prev) && isUpper(c)) bonus = 10;
  else if (!isDigit(prev) && isDigit(c)) bonus = 4;
  if (j >= nameStart) bonus += inName;
  if (j === nameStart && nameStart > 0) bonus += 8;
  return bonus;
}

/** Whether the character at `j` begins a word: after a separator, a camelCase hump, a digit run, or the path's start. */
function startsWord(path: string, j: number) {
  if (j === 0) return true;
  const prev = path.charCodeAt(j - 1);
  const c = path.charCodeAt(j);
  return (
    !isWordChar(prev) ||
    (isLower(prev) && isUpper(c)) ||
    (!isDigit(prev) && isDigit(c))
  );
}

/** Whether `needle`'s characters occur in order in `hay`; both lower case. */
function isSubsequence(needle: string, hay: string) {
  let at = 0;
  for (let i = 0; i < needle.length; i++) {
    at = hay.indexOf(needle[i], at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

// Scratch tables, so ranking 50,000 paths allocates nothing per path.
// `scores[i * n + j]` is the best score for query characters 0..i with
// character i placed at path position j; `previous` says where i - 1 went.
let scores = new Int32Array(0);
let previous = new Int32Array(0);

/**
 * Fills the scratch tables: for each query character, every path position
 * it can sit at, scored from the best placement of the character before it.
 */
function fillScores(
  query: string,
  raw: string,
  path: string,
  lower: string,
  nameStart: number,
) {
  const m = query.length;
  const n = path.length;
  if (scores.length < m * n) {
    scores = new Int32Array(m * n);
    previous = new Int32Array(m * n);
  }
  for (let i = 0; i < m; i++) {
    const q = query.charCodeAt(i);
    // Best earlier placement of the previous character, aged by the gap to here.
    let gapBest = NEG;
    let gapFrom = -1;
    for (let j = 0; j < n; j++) {
      const at = i * n + j;
      if (i > 0 && j >= 2) {
        const gapped = scores[(i - 1) * n + (j - 2)] - gapStart;
        if (gapBest - gapExtend > gapped) gapBest -= gapExtend;
        else {
          gapBest = gapped;
          gapFrom = j - 2;
        }
      }
      if (lower.charCodeAt(j) !== q || j < i) {
        scores[at] = NEG;
        continue;
      }
      const here =
        base +
        positionBonus(path, j, nameStart) +
        (raw[i] !== query[i] && raw[i] === path[j] ? 4 : 0);
      if (i === 0) {
        scores[at] = here;
        previous[at] = -1;
        continue;
      }
      const touching = j > 0 ? scores[(i - 1) * n + (j - 1)] : NEG;
      const viaRun = touching > NEG ? touching + consecutive : NEG;
      if (viaRun >= gapBest && viaRun > NEG) {
        scores[at] = viaRun + here;
        previous[at] = j - 1;
      } else if (gapBest > NEG) {
        scores[at] = gapBest + here;
        previous[at] = gapFrom;
      } else scores[at] = NEG;
    }
  }
}

/** The path position where the whole query ends best, or -1 when it fits nowhere. */
function bestEnd(m: number, n: number) {
  let best = NEG;
  let end = -1;
  for (let j = 0; j < n; j++) {
    const score = scores[(m - 1) * n + j];
    if (score > best) {
      best = score;
      end = j;
    }
  }
  return end;
}

/** The path position of each query character on the best placement ending at `end`. */
function placementEndingAt(m: number, n: number, end: number) {
  const indices = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; i--) {
    indices[i] = j;
    j = previous[i * n + j];
  }
  return indices;
}

/**
 * Letters picked out of the middle of words are noise ("todo" in
 * "src/features/editor/documents.ts"): most must start a word or follow the
 * letter before.
 */
function isMostlyAnchored(path: string, indices: number[]) {
  let anchored = 0;
  for (let i = 0; i < indices.length; i++) {
    const startsHere = startsWord(path, indices[i]);
    const followsPrevious = i > 0 && indices[i] === indices[i - 1] + 1;
    if (startsHere || followsPrevious) anchored++;
  }
  return anchored >= Math.ceil(indices.length * 0.6);
}

/** Extra score for a query that looks like the file's name, or most of it. */
function fileNameBonus(
  query: string,
  lower: string,
  nameStart: number,
  first: number,
) {
  let bonus = 0;
  if (first >= nameStart) bonus += 20;
  const name = lower.slice(nameStart);
  if (name.startsWith(query)) bonus += 20;
  const dot = name.lastIndexOf(".");
  const isWholeName =
    name === query || (dot > 0 && name.slice(0, dot) === query);
  if (isWholeName) bonus += 40;
  return bonus;
}

/**
 * Matches the characters of `query` (lower case) in order in `path`, picking
 * the placement that scores best, and nothing if it is mostly scattered
 * through the middles of words: runs of adjacent characters, word starts,
 * camelCase humps and the file name count for more; gaps cost. A capital in
 * the query that meets the same capital in the path counts a little extra.
 */
function scorePath(
  query: string,
  raw: string,
  path: string,
  lower: string,
): FuzzyMatch | null {
  const m = query.length;
  const n = path.length;
  if (m > n || !isSubsequence(query, lower)) return null;
  const nameStart = path.lastIndexOf("/") + 1;
  fillScores(query, raw, path, lower, nameStart);
  const end = bestEnd(m, n);
  if (end < 0) return null;
  const indices = placementEndingAt(m, n, end);
  if (!isMostlyAnchored(path, indices)) return null;
  const score =
    scores[(m - 1) * n + end] +
    fileNameBonus(query, lower, nameStart, indices[0]);
  return { path, score: score - n * 0.05, indices };
}

/** The paths with their lower-case copies, made once for a list and searched many times. */
export class PathIndex {
  private lower: string[];
  constructor(readonly paths: readonly string[]) {
    this.lower = paths.map((p) => p.toLowerCase());
  }

  /** The best `limit` paths for `text`, best first; equal scores keep shorter and earlier paths first. */
  rank(text: string, limit = 100): FuzzyMatch[] {
    const query = text.replace(/\\/g, "/").replace(/\s+/g, "");
    if (!query) return [];
    const lowerQuery = query.toLowerCase();
    const found: FuzzyMatch[] = [];
    for (let i = 0; i < this.paths.length; i++) {
      const hit = scorePath(lowerQuery, query, this.paths[i], this.lower[i]);
      if (hit) found.push(hit);
    }
    found.sort(
      (a, b) =>
        b.score - a.score ||
        a.path.length - b.path.length ||
        (a.path < b.path ? -1 : 1),
    );
    return found.slice(0, limit);
  }
}
