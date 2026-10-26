// A big change reviewed in passes: each pass is a few folders or files that
// every reviewer reviews on its own, one pass after another, so none of them
// skims the part it got to last. What each pass covers; suggest-passes.ts
// proposes them.
import { diffKind } from "./diff-kinds";
import { formatTokens } from "./tokens";

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * The paths a pass reviews, as written in the setup: folders end in `/`,
 * and `!path` leaves something out. A path belongs to the pass that names
 * it most closely, so `src/` in one pass and `src/editor/` in another split
 * `src/` in two.
 */
export type ReviewPass = string[];

/** Lockfiles, fixtures and generated files: in the change, but not read line by line. */
export const leftOut = (path: string) => {
  const kind = diffKind(path);
  return kind === "generated" || kind === "fixtures";
};

/** "1.8k lines". */
export const formatLines = (n: number) =>
  `${formatTokens(n)} ${n === 1 ? "line" : "lines"}`;

/** The lines a reviewer reads in a file. */
export const readLines = (f: ChangedFile) =>
  leftOut(f.path) ? 0 : f.additions + f.deletions;

export const bare = (path: string) =>
  path.replace(/^\.\//, "").replace(/\/+$/, "") || ".";

const included = (pass: ReviewPass) => pass.filter((p) => !p.startsWith("!"));

const excluded = (pass: ReviewPass) =>
  pass.filter((p) => p.startsWith("!")).map((p) => p.slice(1));

/** Whether `entry` names `path` or a folder it's in; `.` names everything. */
export function names(entry: string, path: string) {
  const name = bare(entry);
  return name === "." || path === name || path.startsWith(`${name}/`);
}

/** How closely a pass names `path`: the length of its longest path that does, or -1. */
function closeness(pass: ReviewPass, path: string) {
  let best = -1;
  for (const entry of included(pass))
    if (names(entry, path))
      best = Math.max(best, bare(entry) === "." ? 0 : bare(entry).length);
  return best;
}

/** Whether pass `i` reviews `path`: it names it, and no other pass names it more closely. */
export function covers(passes: ReviewPass[], i: number, path: string) {
  const pass = passes[i]!;
  const own = closeness(pass, path);
  if (own < 0 || excluded(pass).some((p) => names(p, path))) return false;
  return passes.every((other, j) => j === i || closeness(other, path) <= own);
}

/**
 * Pass `i` as Git pathspecs: its paths, less what other passes name more
 * closely, and less the lockfiles, fixtures and generated files in it
 * unless it names one itself.
 */
export function passPathspecs(
  passes: ReviewPass[],
  i: number,
  files: readonly ChangedFile[],
) {
  const pass = passes[i]!;
  const mine = included(pass);
  const deeper = passes.flatMap((other, j) =>
    j === i
      ? []
      : included(other).filter((entry) =>
          mine.some((p) => bare(p) !== bare(entry) && names(p, bare(entry))),
        ),
  );
  const named = new Set(mine.map(bare));
  const skipped = files
    .filter((f) => leftOut(f.path) && !named.has(f.path))
    .filter((f) => covers(passes, i, f.path))
    .map((f) => f.path);
  const left = [...excluded(pass), ...deeper, ...skipped].map(bare);
  return [
    ...mine.map(bare),
    ...left
      .filter((p) => !left.some((q) => q !== p && names(q, p)))
      .map((p) => `:(exclude)${p}`),
  ];
}

export function passesText(passes: ReviewPass[]) {
  const quoted = (p: string) => (/\s/.test(p) ? JSON.stringify(p) : p);
  return passes.map((pass) => pass.map(quoted).join(" ")).join("\n");
}

/** One pass a line, its paths split by spaces; a path with spaces is quoted. */
export function parsePasses(text: string): ReviewPass[] {
  return text
    .split("\n")
    .map((line) =>
      [...line.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2])!),
    )
    .filter((pass) => pass.length > 0);
}

/** What each pass reads, and what changed that no pass does. */
export function passCoverage(
  passes: ReviewPass[],
  files: readonly ChangedFile[],
) {
  const read = files.filter((f) => readLines(f) > 0);
  return {
    passes: passes.map((_, i) => {
      const covered = read.filter((f) => covers(passes, i, f.path));
      return {
        files: covered.length,
        lines: covered.reduce((n, f) => n + readLines(f), 0),
      };
    }),
    missed: read.filter(
      (f) => !passes.some((_, i) => covers(passes, i, f.path)),
    ),
  };
}

/**
 * Each pass as a review runs it: what its reviewers diff, and the lines they
 * read. `seams` adds a last pass over the whole change, for how the parts
 * fit together.
 */
export function passPlan(
  passes: ReviewPass[],
  files: readonly ChangedFile[],
  { seams = false } = {},
) {
  const { passes: covered } = passCoverage(passes, files);
  const total = files.reduce((n, f) => n + readLines(f), 0);
  return [
    ...passes.map((paths, i) => ({
      paths,
      specs: passPathspecs(passes, i, files),
      lines: covered[i]!.lines,
    })),
    ...(seams ? [{ paths: [], specs: [], lines: total, seams: true }] : []),
  ];
}
