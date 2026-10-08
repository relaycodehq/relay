/** A path the query matched, and which of its characters did the matching. */
export interface PathMatch {
  path: string;
  score: number;
  positions: number[];
}

const separators = "/-_. ";
const GAP = 1;
const CONSECUTIVE = 6;
const IN_NAME = 4;
const NAME_TIER = 100;

// Scratch tables, reused across paths: allocating per path was most of the time.
let best = new Float64Array(1024),
  lead = new Float64Array(1024),
  from = new Int32Array(1024);
function grow(size: number) {
  if (size <= best.length) return;
  best = new Float64Array(size * 2);
  lead = new Float64Array(size * 2);
  from = new Int32Array(size * 2);
}

/** What a character is worth as a match: more where a word or the file name starts. */
function startBonus(path: string, i: number, nameStart: number) {
  if (i === 0 || i === nameStart || path[i - 1] === "/") return 9;
  if (separators.includes(path[i - 1])) return 7;
  const lowerBefore = path[i - 1] !== path[i - 1].toUpperCase();
  if (lowerBefore && path[i] !== path[i].toLowerCase()) return 7;
  return 0;
}

/**
 * Scores `path` for `query`, its letters in order but not necessarily side by
 * side. A query the file name alone holds ranks above one that needs the
 * folders, as in VS Code; within that, word starts and letters in a row count
 * most, so `pcomp` finds `ProjectComposer.tsx` before `packages/compat/`. A
 * slash in the query matches the whole path. Null when the letters aren't all
 * there.
 */
export function matchPath(path: string, query: string): PathMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { path, score: 0, positions: [] };
  const lower = path.toLowerCase();
  const trimmed = path.endsWith("/") ? path.length - 1 : path.length;
  const nameStart = path.lastIndexOf("/", trimmed - 1) + 1;
  // Most paths fail here, before the table below is built.
  const fromName = !q.includes("/") && contains(lower, q, nameStart);
  if (!fromName && !contains(lower, q, 0)) return null;
  const found = align(path, lower, q, nameStart, fromName ? nameStart : 0);
  if (!found) return null;
  const name = lower.slice(nameStart, trimmed);
  const stem = name.replace(/\.[^.]+$/, "");
  const exact = name === q || stem === q ? 25 : 0;
  // Of two equal matches, the shorter path is likelier the one meant.
  const score =
    found.score + exact - path.length * 0.05 + (fromName ? NAME_TIER : 0);
  return { path, score, positions: found.positions };
}

/** Whether `q`'s letters appear in order in `lower` from `from` on. */
function contains(lower: string, q: string, from: number) {
  for (let i = 0, at = from; i < q.length; i++, at++) {
    at = lower.indexOf(q[i], at);
    if (at < 0) return false;
  }
  return true;
}

/** The best placement of `q`'s letters in `path` from `first` on. */
function align(
  path: string,
  lower: string,
  q: string,
  nameStart: number,
  first: number,
) {
  const n = path.length,
    m = q.length;
  grow(n * m);
  // best[i*n+j]: the best score with query letter i on path character j.
  best.fill(-Infinity, 0, n * m);
  for (let i = 0; i < m; i++) {
    const row = i * n,
      above = row - n;
    // The best earlier placement of letter i-1, less a point per character skipped.
    let runBest = -Infinity,
      runAt = -1;
    for (let j = first + i; j < n; j++) {
      if (
        i > 0 &&
        j - 2 >= first &&
        best[above + j - 2] + GAP * (j - 2) > runBest
      ) {
        runBest = best[above + j - 2] + GAP * (j - 2);
        runAt = j - 2;
      }
      if (lower[j] !== q[i]) continue;
      const bonus = startBonus(path, j, nameStart);
      const inName = j >= nameStart ? IN_NAME : 0;
      if (i === 0) {
        // Starting deep into the path costs a little.
        best[row + j] = 1 + bonus + inName - Math.min(j - first, 20) * 0.2;
        lead[row + j] = bonus;
        continue;
      }
      const prev = j > 0 ? best[above + j - 1] : -Infinity;
      // A run of letters is worth what its first letter is, as in fzf.
      const runBonus = Math.max(
        bonus,
        prev > -Infinity ? lead[above + j - 1] : 0,
      );
      const adjacent = prev + CONSECUTIVE + 1 + runBonus + inName;
      const skipped =
        runAt >= 0 ? runBest - GAP * (j - 1) + 1 + bonus + inName : -Infinity;
      if (adjacent >= skipped && prev > -Infinity) {
        best[row + j] = adjacent;
        from[row + j] = j - 1;
        lead[row + j] = runBonus;
      } else if (skipped > -Infinity) {
        best[row + j] = skipped;
        from[row + j] = runAt;
        lead[row + j] = bonus;
      }
    }
  }
  const last = (m - 1) * n;
  let end = 0;
  for (let j = 1; j < n; j++) if (best[last + j] > best[last + end]) end = j;
  if (best[last + end] === -Infinity) return null;
  const positions: number[] = [];
  for (let i = m - 1, j = end; i >= 0; j = from[i * n + j], i--)
    positions.unshift(j);
  return { score: best[last + end], positions };
}

/** The best `limit` matches for `query`, best first. */
export function rankPaths(paths: Iterable<string>, query: string, limit = 50) {
  const found: PathMatch[] = [];
  for (const path of paths) {
    const match = matchPath(path, query);
    if (match) found.push(match);
  }
  return found
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/** Every folder the files sit in, as `dir/`, so a folder can be mentioned too. */
export function foldersOf(files: string[]) {
  const folders = new Set<string>();
  for (const file of files)
    for (let at = file.indexOf("/"); at > 0; at = file.indexOf("/", at + 1))
      folders.add(file.slice(0, at + 1));
  return [...folders];
}
