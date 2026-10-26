// The passes Relay suggests for a big change, from its files alone: by
// language, then along the folder tree, a feature's folders kept together.
import {
  bare,
  leftOut,
  names,
  readLines,
  type ChangedFile,
  type ReviewPass,
} from "./review-passes";

/** About what a reviewer still reads closely in one go; past it, a review is split. */
export const PASS_LINES = 5000;
/** Every pass runs every reviewer, so past this many the passes grow instead. */
export const MAX_PASSES = 6;
/** A pass smaller than this joins the one beside it. */
const SMALL_PASS = PASS_LINES / 4;

// Code in one language is read together: a change to the Kotlin app and the
// Swift app are two passes even when both are small.
const LANGUAGES: Record<string, string> = {
  ts: "web",
  tsx: "web",
  js: "web",
  jsx: "web",
  mjs: "web",
  cjs: "web",
  css: "web",
  scss: "web",
  html: "web",
  vue: "web",
  svelte: "web",
  kt: "jvm",
  kts: "jvm",
  java: "jvm",
  gradle: "jvm",
  scala: "jvm",
  swift: "apple",
  m: "apple",
  mm: "apple",
  py: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  cs: "dotnet",
  dart: "dart",
  c: "c",
  h: "c",
  cc: "c",
  cpp: "c",
  hpp: "c",
};

const languageOf = (path: string) =>
  LANGUAGES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];

interface Folder {
  /** Ends in `/`, but for the repository's root, which is "". */
  path: string;
  lines: number;
  /** The files right in it, by path, and the lines read in each. */
  files: Map<string, number>;
  folders: Map<string, Folder>;
  languages: Map<string, number>;
}

const folder = (path: string): Folder => ({
  path,
  lines: 0,
  files: new Map(),
  folders: new Map(),
  languages: new Map(),
});

function tree(files: readonly ChangedFile[]) {
  const root = folder("");
  for (const f of files) {
    if (leftOut(f.path)) continue;
    const lines = readLines(f);
    const language = languageOf(f.path);
    const dirs = f.path.split("/").slice(0, -1);
    let node = root;
    for (const dir of [undefined, ...dirs]) {
      if (dir !== undefined) {
        const next = node.folders.get(dir) ?? folder(`${node.path}${dir}/`);
        node.folders.set(dir, next);
        node = next;
      }
      node.lines += lines;
      if (language)
        node.languages.set(
          language,
          (node.languages.get(language) ?? 0) + lines,
        );
    }
    node.files.set(f.path, lines);
  }
  return root;
}

/** Paths a pass holds, and the lines read under them. */
interface Part {
  paths: string[];
  lines: number;
  /** A folder's name, which the same feature's folder elsewhere shares. */
  name?: string;
}

const byPath = <T extends { path: string }>(items: Iterable<T>) =>
  [...items].sort((a, b) => (a.path < b.path ? -1 : 1));

const joined = (parts: Part[]): Part => ({
  paths: parts.flatMap((p) => p.paths),
  lines: parts.reduce((n, p) => n + p.lines, 0),
});

/** Neighbours go together while they fit in a pass, so a pass reads as one part of the tree. */
function packed(parts: Part[]) {
  const passes: Part[] = [];
  for (const part of parts) {
    const last = passes.at(-1);
    if (last && last.lines + part.lines <= PASS_LINES)
      passes.splice(-1, 1, joined([last, part]));
    else passes.push(part);
  }
  return passes;
}

/**
 * A folder as parts of passes: whole while it fits, else its own files as
 * one part (named by the folder, which the folders inside it named
 * elsewhere leave) and each folder inside it split the same way.
 */
function split(node: Folder): Part[] {
  if (node.lines <= PASS_LINES || !node.folders.size)
    return [{ paths: [node.path], lines: node.lines, name: nameOf(node) }];
  const own = [...node.files.values()].reduce((n, l) => n + l, 0);
  // A few files read better by name than as the folder they're in.
  const paths = node.files.size <= 3 ? [...node.files.keys()] : [node.path];
  return [
    ...(node.files.size ? [{ paths, lines: own, name: nameOf(node) }] : []),
    ...byPath(node.folders.values()).flatMap(split),
  ];
}

// Names too common to say two folders hold the same feature.
const GENERIC = new Set(
  "api app assets common components core docs features helpers internal java kotlin lib main resources scripts shared src styles swift test tests types ui util utils".split(
    " ",
  ),
);

/** A folder's name, or the name of the one folder all its changes are in. */
function nameOf(node: Folder) {
  while (!node.files.size && node.folders.size === 1)
    node = [...node.folders.values()][0]!;
  const name = node.path.split("/").at(-2);
  return name && !GENERIC.has(name.toLowerCase()) ? name : undefined;
}

/**
 * A feature's folders read together: `src/features/search/` joins
 * `electron/search/`, where the first of them is, unless that makes a pass
 * much too big.
 */
function paired(parts: Part[]) {
  const out: Part[] = [];
  for (const part of parts) {
    const twin = out.find(
      (p) =>
        part.name &&
        p.name === part.name &&
        p.lines + part.lines <= PASS_LINES * 1.5,
    );
    if (twin) Object.assign(twin, joined([twin, part]), { name: twin.name });
    else out.push({ ...part });
  }
  return out;
}

/** Joins a pass too small to be worth its reviewers to its smaller neighbour. */
function joinSmall(passes: Part[]) {
  const i = passes.findIndex((p) => p.lines < SMALL_PASS);
  if (i < 0 || passes.length < 2) return false;
  const before = passes[i - 1],
    after = passes[i + 1];
  const first = !after || (before && before.lines <= after.lines) ? i - 1 : i;
  passes.splice(first, 2, joined(passes.slice(first, first + 2)));
  return true;
}

/** Joins the two neighbouring passes that make the smallest pass together. */
function joinSmallest(passes: Part[]) {
  let best = 0;
  for (let i = 1; i < passes.length - 1; i++)
    if (
      passes[i]!.lines + passes[i + 1]!.lines <
      passes[best]!.lines + passes[best + 1]!.lines
    )
      best = i;
  passes.splice(best, 2, joined(passes.slice(best, best + 2)));
}

/**
 * The passes Relay suggests for a change, or none when one pass reads it
 * well. Each language's top folders are a pass of their own, a pass too big
 * is split along its folders, a feature's folders go together, and small
 * passes join their neighbours.
 */
export function suggestPasses(files: readonly ChangedFile[]): ReviewPass[] {
  const root = tree(files);
  if (root.lines <= PASS_LINES) return [];
  // Top folders by the language most of their lines are in; files at the
  // top and folders in no language (docs, config) go with the biggest.
  const byLanguage = new Map<string, Folder[]>();
  const loose: Folder[] = [...root.files].map(([path, lines]) => ({
    ...folder(path),
    lines,
  }));
  for (const top of byPath(root.folders.values())) {
    const language = [...top.languages].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (language)
      byLanguage.set(language, [...(byLanguage.get(language) ?? []), top]);
    else loose.push(top);
  }
  const groups = [...byLanguage.values()];
  const linesIn = (group: Folder[]) => group.reduce((n, f) => n + f.lines, 0);
  const biggest = groups.reduce<Folder[] | undefined>(
    (a, b) => (!a || linesIn(b) > linesIn(a) ? b : a),
    undefined,
  );
  if (biggest) biggest.push(...loose);
  else groups.push(loose);
  const passes = groups.flatMap((group) =>
    packed(paired(byPath(group).flatMap(split))),
  );
  while (joinSmall(passes));
  while (passes.length > MAX_PASSES) joinSmallest(passes);
  return passes.length > 1 ? tidy(passes.map((p) => p.paths)) : [];
}

/**
 * Drops a path its pass already holds through a folder above it, unless
 * another pass names something in between, which the path takes back.
 */
function tidy(passes: ReviewPass[]) {
  const between = (i: number, above: string, entry: string) =>
    passes.some(
      (other, j) =>
        j !== i &&
        other.some(
          (e) =>
            bare(e) !== bare(above) && names(above, bare(e)) && names(e, entry),
        ),
    );
  return passes.map((pass, i) =>
    pass.filter(
      (entry) =>
        !pass.some(
          (above) =>
            bare(above) !== bare(entry) &&
            names(above, bare(entry)) &&
            !between(i, above, bare(entry)),
        ),
    ),
  );
}
