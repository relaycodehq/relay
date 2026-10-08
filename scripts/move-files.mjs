#!/usr/bin/env node
// Moves files according to a mapping and rewrites every relative reference so
// it still points at the same file, then reports what a human has to look at.
// Reusable for any future reshuffle: write the mapping, dry-run, read the
// report, apply, commit.
//
//   node scripts/move-files.mjs <mapping.json> [--dry] [--force]
//
//   --dry    print the report and write nothing (exit 1 if something would break)
//   --force  apply even when some reference would not resolve afterwards
//
// The mapping is { "old/path.ts": "new/path.ts", ... }: repo-root-relative,
// file to file (list every file of a folder you want moved; the script moves
// no folders). It is checked first: sources must exist, targets must be free
// or themselves moving, no two files may share a target (swaps and cycles are
// fine). It runs from the checkout it sits in, never calls git and never
// stages anything. Commit or stash other work first so the diff is only the
// move.
//
// Rewrites, in the moved files' new homes and in every file that points at a
// moved one (src, electron, shared, server, tests, previews, scripts,
// mobile/src and the root-level .ts, .html and .js files):
//   import/export ... from, side-effect imports, import("..."), require("..."),
//   require.resolve, import.meta.resolve, typeof import("..."), vi/jest
//   .mock/.doMock/.importActual/..., new URL(..., import.meta.url),
//   /// <reference path>, CSS @import and url(...), HTML src/href/poster
//   (relative and root-absolute). Vite query suffixes (?worker, ?raw, ...) and
//   #fragments are kept. Specifiers into build output that isn't on disk
//   (dist-*, anything top-level in .gitignore or .git/info/exclude) keep pointing at the same place.
//
// Resolution mirrors the bundler (exact file, extensions, a written .js that
// is really a .ts, dir/index.*) and the author's style is kept: extension
// written or omitted, index elided or not, quotes, "./" prefix. A specifier
// is only shortened to a directory form ("." ".." "x/") when the directory's
// index is the file it reaches; "." never stands in for a sibling x.ts.
//
// Only reports, never rewrites (the "String mentions" part of the report):
//   - full old paths in strings, comments, docs, configs and scripts
//     (package.json scripts, workflows, README, prose),
//   - relative path strings that aren't imports but reach a moved file,
//   - directories that files moved out of,
//   - bare file names that may mean a moved file (weakest signal).
// Those can be a live reference, or sample text in a fixture or a mock UI;
// only a person can tell. Also listed: specifiers that were already broken
// before the move and left alone, and the "UNRESOLVED AFTER THE MOVE" section,
// which must be empty (otherwise nothing is touched unless --force).
//
// After applying, run the type check and the tests, and look at what the
// mentions list points at. Not understood: path strings built at runtime,
// tsconfig/package.json "include"/"files" globs and the like.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  resolve as resolvePath,
  relative as relativePath,
} from "node:path";
import { posix as path } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
if (flags.has("--help") || positional.length !== 1) {
  console.error(
    "usage: node scripts/move-files.mjs <mapping.json> [--dry] [--force]",
  );
  console.error("  --dry    print the report, write nothing");
  console.error(
    "  --force  apply even when some reference would not resolve afterwards",
  );
  process.exit(flags.has("--help") ? 0 : 2);
}
const dry = flags.has("--dry");
const force = flags.has("--force");
const mappingFile = resolvePath(positional[0]);

// -------------------------------------------------------------- filesystem

const listings = new Map();
/** Directory entries, case-exact, so a case-insensitive disk can't invent files. */
function entries(dir) {
  let list = listings.get(dir);
  if (!list) {
    try {
      list = new Set(readdirSync(resolvePath(root, dir)));
    } catch {
      list = new Set();
    }
    listings.set(dir, list);
  }
  return list;
}
/** The path as it exists on disk (any case) or null. */
function existingEntry(p) {
  const dir = path.dirname(p);
  const name = path.basename(p);
  const list = entries(dir);
  if (list.has(name)) return p;
  for (const n of list)
    if (n.toLowerCase() === name.toLowerCase()) return path.join(dir, n);
  return null;
}
const fileKinds = new Map();
function isFileOnDisk(p) {
  if (!entries(path.dirname(p)).has(path.basename(p))) return false;
  let kind = fileKinds.get(p);
  if (kind === undefined) {
    try {
      kind = statSync(resolvePath(root, p)).isFile();
    } catch {
      kind = false;
    }
    fileKinds.set(p, kind);
  }
  return kind;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".idea"]);
function walk(dir = "", out = []) {
  for (const name of readdirSync(resolvePath(root, dir)).sort()) {
    const rel = dir ? `${dir}/${name}` : name;
    let st;
    try {
      st = statSync(resolvePath(root, rel));
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      if (!dir && isGenerated(name)) continue;
      if (
        rel === "mobile/android" ||
        rel === "mobile/ios" ||
        rel === ".claude/skills"
      )
        continue;
      walk(rel, out);
    } else if (st.isFile()) out.push({ rel, size: st.size });
  }
  return out;
}

// Top-level names the repo ignores: build output, and local clones listed only
// in .git/info/exclude. The walk skips them, and relative specifiers that
// point there (and so don't exist) still have to keep pointing there.
const generatedTop = new Set();
for (const file of [".gitignore", ".git/info/exclude"]) {
  try {
    for (const line of readFileSync(resolvePath(root, file), "utf8").split(
      "\n",
    )) {
      const m = /^\/?([\w.-]+)\/?$/.exec(line.trim());
      if (m && !line.trim().startsWith("*")) generatedTop.add(m[1]);
    }
  } catch {}
}
const isGenerated = (p) => {
  const top = p.split("/")[0];
  return generatedTop.has(top) || top.startsWith("dist");
};

// ------------------------------------------------------------------ mapping

const norm = (p) => path.normalize(p.replace(/\\/g, "/")).replace(/^\.\//, "");
let raw;
try {
  raw = JSON.parse(readFileSync(mappingFile, "utf8"));
} catch (e) {
  console.error(`cannot read mapping ${mappingFile}: ${e.message}`);
  process.exit(2);
}

const map = new Map(); // old -> new, identity entries dropped
const errors = [];
const seenSources = new Set();
for (const [from, to] of Object.entries(raw)) {
  if (typeof to !== "string") {
    errors.push(`${from}: target is not a string`);
    continue;
  }
  const a = norm(from);
  const b = norm(to);
  for (const [label, p] of [
    ["source", a],
    ["target", b],
  ]) {
    if (
      path.isAbsolute(p) ||
      p.startsWith("..") ||
      p === "." ||
      p.endsWith("/")
    )
      errors.push(
        `${label} ${JSON.stringify(p)} must be a repo-relative file path`,
      );
    if (p.split("/").includes("node_modules") || p.startsWith(".git/"))
      errors.push(`${label} ${p} is inside node_modules or .git`);
  }
  if (seenSources.has(a)) errors.push(`${a} appears twice as a source`);
  seenSources.add(a);
  if (a === b) continue;
  map.set(a, b);
}
const targets = new Set(map.values());
const sources = new Set(map.keys());
{
  const byTarget = new Map();
  const byFolded = new Map();
  for (const [a, b] of map) {
    if (byTarget.has(b))
      errors.push(`${byTarget.get(b)} and ${a} both map to ${b}`);
    byTarget.set(b, a);
    const folded = b.toLowerCase();
    if (byFolded.has(folded) && byFolded.get(folded) !== b)
      errors.push(
        `${byFolded.get(folded)} and ${b} differ only in case (case-insensitive disks merge them)`,
      );
    byFolded.set(folded, b);
    if (!isFileOnDisk(a))
      errors.push(`source ${a} does not exist (or is not a file)`);
    // On a case-insensitive disk Foo.tsx -> foo.tsx "exists"; that's fine only when it is the file being moved.
    const clash = existingEntry(b);
    if (clash && !sources.has(clash))
      errors.push(
        `target ${b} already exists${clash === b ? "" : ` (as ${clash})`} and is not itself being moved`,
      );
    // a target can't sit below a file, whether that file stays or is itself a target
    for (
      let dir = path.dirname(b);
      dir !== "." && dir !== "/";
      dir = path.dirname(dir)
    ) {
      if ((isFileOnDisk(dir) && !sources.has(dir)) || targets.has(dir))
        errors.push(`target ${b} would sit inside the file ${dir}`);
    }
  }
}
if (errors.length) {
  console.error(
    "mapping is invalid:\n" +
      [...new Set(errors)].map((e) => `  ${e}`).join("\n"),
  );
  process.exit(2);
}
if (!map.size) {
  console.log("nothing to move");
  process.exit(0);
}

const moved = (p) => map.has(p);
const existsBefore = isFileOnDisk;
const existsAfter = (p) =>
  targets.has(p) || (isFileOnDisk(p) && !sources.has(p));

// --------------------------------------------------------------- resolution

const EXTS = [
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".cjs",
  ".js",
  ".json",
  ".css",
  ".jsx",
  ".cts",
  ".d.ts",
];
const JS_SWAPS = {
  ".js": [".ts", ".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
  ".jsx": [".tsx"],
};

/**
 * Resolve a repo-relative path like a bundler: { file, via } or null.
 * dirOnly is for specifiers that name a directory ("." ".." "x/" "x/.."):
 * only dir/index.* can answer those, never a sibling file x.ts.
 */
function resolveFile(p, exists, dirOnly = false) {
  if (!p || p.startsWith("..") || p === ".") return null;
  if (!dirOnly) {
    if (exists(p)) return { file: p, via: "exact" };
    for (const e of EXTS) if (exists(p + e)) return { file: p + e, via: "ext" };
    const written = path.extname(p);
    if (JS_SWAPS[written]) {
      const stem = p.slice(0, -written.length);
      for (const e of JS_SWAPS[written])
        if (exists(stem + e)) return { file: stem + e, via: "jsswap" };
    }
  }
  for (const e of EXTS)
    if (exists(`${p}/index${e}`))
      return { file: `${p}/index${e}`, via: "index" };
  return null;
}

function stemOf(file) {
  if (file.endsWith(".d.ts")) return file.slice(0, -5);
  const ext = path.extname(file);
  return EXTS.includes(ext) ? file.slice(0, -ext.length) : file;
}

// Split off ?query and #fragment, which are kept verbatim.
function splitSpec(spec) {
  const i = spec.search(/[?#]/);
  return i < 0 ? [spec, ""] : [spec.slice(0, i), spec.slice(i)];
}

function resolveRef(fromFile, ref, exists) {
  const [base] = splitSpec(ref.spec);
  const joined = ref.rootAbsolute
    ? norm(base.replace(/^\/+/, ""))
    : path.join(path.dirname(fromFile), base);
  const lexical = joined.length > 1 ? joined.replace(/\/+$/, "") : joined;
  const dirOnly = /(?:^|\/)\.{1,2}$|\/$/.test(base);
  return { lexical, result: resolveFile(lexical, exists, dirOnly) };
}

/**
 * Where target sits from fromDir, written as a specifier. isDirectory says
 * target really is a directory; otherwise it is a file's extensionless path,
 * and when that comes out as "." or "..", which would name a directory, it
 * is spelled through its parent instead ("../projects", not "..").
 */
function relSpec(fromDir, target, ref, trailingSlash, isDirectory = true) {
  if (ref.rootAbsolute)
    return "/" + target + (trailingSlash && target ? "/" : "");
  let rel = path.relative(fromDir || ".", target || ".");
  if (!isDirectory && (rel === "" || path.basename(rel) === "..")) {
    const up = path.relative(fromDir || ".", path.dirname(target));
    rel = path.join(up, path.basename(target));
  }
  if (rel === "") rel = ".";
  if (!rel.startsWith(".") && ref.dotPrefix !== false) rel = "./" + rel;
  if (trailingSlash && !rel.endsWith("/")) rel += "/";
  return rel;
}

/**
 * The specifier that, written in the file's new home, reaches the new
 * location of what it used to reach, in the author's style. Null if none does.
 */
function buildSpec(oldFrom, newFrom, ref, found) {
  const [base, suffix] = splitSpec(ref.spec);
  const oldTarget = found.file;
  const newTarget = map.get(oldTarget) ?? oldTarget;
  const trailing = base.endsWith("/") && base.length > 1;
  const newDir = path.dirname(newFrom);
  const writtenExt = path.extname(base);
  const oldIsIndex = path.basename(stemOf(oldTarget)) === "index";
  const newIsIndex = path.basename(stemOf(newTarget)) === "index";
  const explicitSwap = stemOf(newTarget) + writtenExt;

  const candidates = [];
  const dirForm = () => path.dirname(newTarget);
  // A bare "." reads oddly where "./index" says the same, unless that is what was written.
  const dirIsHere = path.relative(newDir || ".", dirForm()) === "";
  const dirFirst = () =>
    dirIsHere && base !== "." && base !== "./"
      ? [stemOf(newTarget), newTarget]
      : [dirForm(), stemOf(newTarget), newTarget];
  switch (found.via) {
    case "exact":
      candidates.push(newTarget);
      break;
    case "jsswap":
      candidates.push(explicitSwap, newTarget);
      break;
    case "ext":
      if (!oldIsIndex && newIsIndex) candidates.push(...dirFirst());
      else candidates.push(stemOf(newTarget), newTarget);
      break;
    case "index":
      if (newIsIndex) candidates.push(...dirFirst());
      else candidates.push(stemOf(newTarget), newTarget);
      break;
  }
  for (const c of candidates) {
    const written = relSpec(
      newDir,
      c,
      ref,
      newIsIndex && c === dirForm() && trailing,
      c === dirForm(),
    );
    const check = resolveRef(
      newFrom,
      { ...ref, spec: written },
      existsAfter,
    ).result;
    if (check && check.file === newTarget) return written + suffix;
  }
  return null;
}

// -------------------------------------------------------------- extraction

const SCRIPT_EXT = /\.(?:[cm]?[jt]sx?)$/;
const kindOf = (f) =>
  SCRIPT_EXT.test(f)
    ? "script"
    : f.endsWith(".css")
      ? "css"
      : /\.html?$/.test(f)
        ? "html"
        : null;

const Q = String.raw`(["'\`])`;
const SPEC = String.raw`(\.{1,2}(?:\/[^"'\`\n]*)?)`;
const scriptPatterns = [
  // from "x" · import "x" · import("x") · require("x") · require.resolve("x") · import.meta.resolve("x")
  new RegExp(
    String.raw`(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*(?:\.resolve\s*)?\(\s*|\bimport\.meta\.resolve\s*\(\s*)` +
      Q +
      SPEC +
      String.raw`\1`,
    "g",
  ),
  // vi.mock("x") · vi.importActual<typeof import("x")>("x"); kept apart so the import() inside <...> is found too
  new RegExp(
    String.raw`\b(?:vi|jest)\.\w+\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(\s*` +
      Q +
      SPEC +
      String.raw`\1`,
    "g",
  ),
  // new URL("x", import.meta.url)
  new RegExp(
    String.raw`\bnew\s+URL\s*\(\s*` +
      Q +
      SPEC +
      String.raw`\1\s*,\s*import\.meta\.url`,
    "g",
  ),
  // /// <reference path="x" />
  new RegExp(
    String.raw`<reference\s+path\s*=\s*` + Q + SPEC + String.raw`\1`,
    "g",
  ),
];
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function* matchesOf(re, text) {
  re.lastIndex = 0;
  for (let m; (m = re.exec(text));) {
    const [whole, quote, spec] = m;
    const start = m.index + whole.lastIndexOf(quote + spec) + 1;
    yield { spec, start, end: start + spec.length };
  }
}

function extractRefs(file, text) {
  const kind = kindOf(file);
  const refs = [];
  const seen = new Set();
  const add = (r) => {
    if (seen.has(r.start)) return;
    seen.add(r.start);
    refs.push(r);
  };
  if (kind === "script" || kind === "html") {
    for (const re of scriptPatterns)
      for (const r of matchesOf(re, text)) add(r);
  }
  if (kind === "css" || kind === "html") {
    const css = [
      [/@import\s+(["'])([^"']+)\1/g, 2],
      [/@import\s+url\(\s*(["']?)([^"')\s]+)\1\s*\)/g, 2],
      [/\burl\(\s*(["']?)([^"')\s]+)\1\s*\)/g, 2],
    ];
    for (const [re, group] of css) {
      re.lastIndex = 0;
      for (let m; (m = re.exec(text));) {
        const spec = m[group];
        if (EXTERNAL.test(spec)) continue;
        const start = m.index + m[0].lastIndexOf(spec);
        add({
          spec,
          start,
          end: start + spec.length,
          rootAbsolute: spec.startsWith("/"),
          dotPrefix: spec.startsWith("."),
        });
      }
    }
  }
  if (kind === "html") {
    const re = /\b(?:src|href|poster)\s*=\s*(["'])([^"']*)\1/gi;
    for (let m; (m = re.exec(text));) {
      const spec = m[2];
      if (!spec || EXTERNAL.test(spec)) continue;
      const start = m.index + m[0].lastIndexOf(spec);
      add({
        spec,
        start,
        end: start + spec.length,
        rootAbsolute: spec.startsWith("/"),
        dotPrefix: spec.startsWith("."),
      });
    }
  }
  for (const r of refs) {
    if (r.rootAbsolute === undefined) r.rootAbsolute = false;
    if (r.dotPrefix === undefined) r.dotPrefix = true;
  }
  return refs.sort((a, b) => a.start - b.start);
}

// ----------------------------------------------------------------- planning

const inScanRoot = (rel) => {
  const top = rel.split("/")[0];
  if (
    [
      "src",
      "electron",
      "shared",
      "server",
      "tests",
      "previews",
      "scripts",
    ].includes(top)
  )
    return true;
  if (rel.startsWith("mobile/src/")) return true;
  return !rel.includes("/");
};
const allFiles = walk();
const scanSet = new Set();
for (const { rel } of allFiles) {
  const kind = kindOf(rel);
  if (!kind) continue;
  if (!inScanRoot(rel)) continue;
  if (!rel.includes("/") && !/\.(?:ts|html|[cm]?js)$/.test(rel)) continue;
  scanSet.add(rel);
}
const outsideScan = [];
for (const src of sources) {
  if (kindOf(src) && !scanSet.has(src)) {
    scanSet.add(src);
    outsideScan.push(src);
  }
}

const original = new Map(); // old path -> text
const edited = new Map(); // old path -> new text
const rewrittenPer = new Map(); // old path -> count
const unresolvedAfter = [];
const keptGenerated = [];
const preUnresolvedMoved = [];
let preUnresolvedOther = 0;
const refSpans = new Map(); // old path -> [[start, end]]

const lineOf = (text, offset) => {
  let n = 1;
  for (
    let i = text.indexOf("\n");
    i >= 0 && i < offset;
    i = text.indexOf("\n", i + 1)
  )
    n++;
  return n;
};

for (const file of [...scanSet].sort()) {
  const text = readFileSync(resolvePath(root, file), "utf8");
  original.set(file, text);
  const refs = extractRefs(file, text);
  refSpans.set(
    file,
    refs.map((r) => [r.start, r.end]),
  );
  const newFile = map.get(file) ?? file;
  const edits = [];
  for (const ref of refs) {
    const { lexical, result } = resolveRef(file, ref, existsBefore);
    if (!result) {
      if (!ref.spec.startsWith(".")) continue;
      if (moved(file) && isGenerated(lexical) && !lexical.startsWith("..")) {
        // Build output that doesn't exist yet: keep pointing at the same place.
        const [, suffix] = splitSpec(ref.spec);
        const spec =
          relSpec(path.dirname(newFile), lexical, ref, false) + suffix;
        if (spec !== ref.spec) {
          edits.push({ ...ref, spec });
          keptGenerated.push(
            `${file}:${lineOf(text, ref.start)}  ${ref.spec}  ->  ${spec}`,
          );
        }
      } else if (moved(file))
        preUnresolvedMoved.push(
          `${file}:${lineOf(text, ref.start)}  ${ref.spec}`,
        );
      else preUnresolvedOther++;
      continue;
    }
    if (!moved(file) && !moved(result.file)) continue;
    const spec = buildSpec(file, newFile, ref, result);
    if (spec === null) {
      unresolvedAfter.push(
        `${file}:${lineOf(text, ref.start)}  ${ref.spec}  (was ${result.file}, now ${map.get(result.file) ?? result.file}, from ${newFile})`,
      );
    } else if (spec !== ref.spec) edits.push({ ...ref, spec });
  }
  if (edits.length) {
    let out = text;
    for (const e of edits.sort((a, b) => b.start - a.start))
      out = out.slice(0, e.start) + e.spec + out.slice(e.end);
    edited.set(file, out);
    rewrittenPer.set(file, edits.length);
  }
}

// Independent sanity check: count specifiers that don't resolve, per file,
// in the new content against the new layout, versus the old against the old.
function unresolvedCount(file, text, exists) {
  let n = 0;
  for (const ref of extractRefs(file, text)) {
    if (!ref.spec.startsWith(".")) continue;
    if (!resolveRef(file, ref, exists).result) n++;
  }
  return n;
}
const sanity = [];
for (const file of scanSet) {
  const newFile = map.get(file) ?? file;
  const newText = edited.get(file) ?? original.get(file);
  const before = unresolvedCount(file, original.get(file), existsBefore);
  const after = unresolvedCount(newFile, newText, existsAfter);
  if (after > before)
    sanity.push(`${newFile}: ${before} unresolved before, ${after} after`);
}

// ---------------------------------------------------------- string mentions

const TEXT_EXT =
  /\.(?:[cm]?[jt]sx?|json|md|mdx|css|html?|sh|py|ya?ml|txt|toml|cfg|plist|xml|kt|gradle|properties|conf|example)$/;
const TEXT_NAMES = new Set([
  "Dockerfile",
  "Caddyfile",
  ".gitignore",
  ".dockerignore",
  ".prettierignore",
  ".npmrc",
  "LICENSE",
]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Not glued to a longer path (so mobile/src/x isn't src/x), but a URL's port may precede it.
const BOUNDARY = String.raw`(?:(?<![\w\-./])|(?<=:\d{2,5}))\/?(?:\.{1,2}\/)*`;
const CODE_STEM_EXT = /\.(?:[cm]?[jt]sx?)$/;

const fileAlts = [];
for (const src of sources) {
  fileAlts.push(src);
  if (CODE_STEM_EXT.test(src) && !src.endsWith(".d.ts"))
    fileAlts.push(src.replace(CODE_STEM_EXT, ""));
}
fileAlts.sort((a, b) => b.length - a.length);
const fileRe = new RegExp(
  `${BOUNDARY}(?:${fileAlts.map(esc).join("|")})(?![\\w\\-]|\\.\\w|\\/)`,
  "g",
);

const dirCounts = new Map();
for (const src of sources)
  for (let d = path.dirname(src); d.includes("/"); d = path.dirname(d))
    dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
const dirList = [...dirCounts.keys()].sort((a, b) => b.length - a.length);
const dirRe = new RegExp(
  `${BOUNDARY}(?:${dirList.map(esc).join("|")})(?![\\w\\-]|\\.\\w|\\/[\\w@.\\-])`,
  "g",
);

const baseNames = new Map();
for (const src of sources) {
  const b = path.basename(src);
  if (/\.(?:[cm]?[jt]sx?|html|css)$/.test(b) && !/^index\./.test(b)) {
    if (!baseNames.has(b)) baseNames.set(b, []);
    baseNames.get(b).push(src);
  }
}
const baseRe = baseNames.size
  ? new RegExp(
      String.raw`(["'\`])((?:[\w@.\-]+\/)*)(${[...baseNames.keys()].map(esc).join("|")})\1`,
      "g",
    )
  : null;
const relStrRe = /(["'])(\.{1,2}\/[^"'\n$`]*)\1/g;

const mentions = { path: [], dir: [], relative: [], basename: [] };
const overlapsRef = (spans, a, b) => spans.some(([s, e]) => a < e && b > s);
const describeMove = (file) =>
  moved(file) ? `${file} (moves to ${map.get(file)})` : file;
const lineText = (text, offset) => {
  const s = text.lastIndexOf("\n", offset - 1) + 1;
  let e = text.indexOf("\n", offset);
  if (e < 0) e = text.length;
  return text.slice(s, e).trim().slice(0, 150);
};
const reported = new Set();
const mentionsPerFile = new Map();
function report(bucket, file, text, offset, note) {
  const line = lineOf(text, offset);
  const key = `${file}:${line}`;
  if (bucket !== "dir" && reported.has(key)) return;
  reported.add(key);
  mentionsPerFile.set(file, (mentionsPerFile.get(file) ?? 0) + 1);
  mentions[bucket].push(
    `${describeMove(file)}:${line}  ${note}  | ${lineText(text, offset)}`,
  );
}

for (const { rel, size } of allFiles) {
  if (!TEXT_EXT.test(rel) && !TEXT_NAMES.has(path.basename(rel))) continue;
  if (
    size > 2_000_000 ||
    rel === "package-lock.json" ||
    rel.endsWith("/package-lock.json")
  )
    continue;
  if (
    resolvePath(root, rel) === mappingFile ||
    rel === "scripts/move-files.mjs"
  )
    continue;
  const text =
    original.get(rel) ?? readFileSync(resolvePath(root, rel), "utf8");
  const spans = refSpans.get(rel) ?? [];
  for (let m; (m = fileRe.exec(text));) {
    if (overlapsRef(spans, m.index, m.index + m[0].length)) continue;
    const hit = m[0].replace(/^\/?(?:\.{1,2}\/)*/, "");
    const old = sources.has(hit)
      ? hit
      : [...sources].find((s) => stemOf(s) === hit && CODE_STEM_EXT.test(s));
    report(
      "path",
      rel,
      text,
      m.index,
      `${m[0]} -> ${old ? map.get(old) : "?"}`,
    );
  }
  for (let m; (m = dirRe.exec(text));) {
    if (overlapsRef(spans, m.index, m.index + m[0].length)) continue;
    const dir = m[0].replace(/^\/?(?:\.{1,2}\/)*/, "");
    report(
      "dir",
      rel,
      text,
      m.index,
      `${m[0]} (${dirCounts.get(dir)} moved files under it)`,
    );
  }
  if (kindOf(rel) === "script") {
    for (let m; (m = relStrRe.exec(text));) {
      const start = m.index + 1;
      if (overlapsRef(spans, start, start + m[2].length)) continue;
      const found = resolveFile(
        path.join(path.dirname(rel), m[2].replace(/[?#].*$/, "")),
        existsBefore,
      );
      if (found && moved(found.file))
        report(
          "relative",
          rel,
          text,
          m.index,
          `${m[2]} -> ${map.get(found.file)}`,
        );
    }
    if (baseRe) {
      for (let m; (m = baseRe.exec(text));) {
        const start = m.index + 1;
        if (overlapsRef(spans, start, start + m[0].length - 2)) continue;
        const dirPart = m[2].replace(/\/$/, "");
        const names = baseNames.get(m[3]);
        const hits = dirPart
          ? names.filter(
              (s) =>
                s.endsWith(`/${dirPart}/${m[3]}`) || s === `${dirPart}/${m[3]}`,
            )
          : names;
        if (hits.length)
          report(
            "basename",
            rel,
            text,
            m.index,
            `"${m[2]}${m[3]}" may mean ${hits.map((h) => map.get(h)).join(" or ")}`,
          );
      }
    }
  }
}

// ------------------------------------------------------------------- report

const out = [];
const section = (title, lines, empty) => {
  out.push("", `${title} (${lines.length})`);
  if (!lines.length && empty) out.push(`  ${empty}`);
  for (const l of lines) out.push(`  ${l}`);
};
let totalRewritten = 0;
for (const n of rewrittenPer.values()) totalRewritten += n;

out.push(
  `${dry ? "DRY RUN: " : ""}${map.size} files to move, ${totalRewritten} references rewritten in ${rewrittenPer.size} files`,
);
if (outsideScan.length)
  out.push(
    `(${outsideScan.length} moved scripts sit outside the scan folders; their own references were still rewritten)`,
  );
section(
  "Files moved",
  [...map].map(([a, b]) => `${a} -> ${b}`),
);
section(
  "References rewritten per file",
  [...rewrittenPer]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([f, n]) =>
        `${String(n).padStart(3)}  ${moved(f) ? `${f} -> ${map.get(f)}` : f}`,
    ),
);
if (keptGenerated.length)
  section(
    "Specifiers into build output (not on disk), kept pointing at the same place",
    keptGenerated,
  );
section(
  "Already unresolved before the move, inside moved files (left alone; fixture strings?)",
  preUnresolvedMoved,
);
out.push(
  `  (+${preUnresolvedOther} already-unresolved relative specifiers in files that don't move, untouched)`,
);
section(
  "UNRESOLVED AFTER THE MOVE (must be empty)",
  [...unresolvedAfter, ...sanity.map((s) => `sanity: ${s}`)],
  "none",
);
out.push(
  "",
  "String mentions: old paths outside imports. Not rewritten, a human decides.",
);
out.push(
  `  ${mentionsPerFile.size} files to look at: ` +
    [...mentionsPerFile]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([f, n]) => `${f} (${n})`)
      .join(", "),
);
section("  Full path mentions", mentions.path, "none");
section(
  "  Relative path strings that point at a moved file",
  mentions.relative,
  "none",
);
section(
  "  Directory mentions (folder had files moved out)",
  mentions.dir,
  "none",
);
section(
  "  Bare file names that might mean a moved file (weakest signal)",
  mentions.basename,
  "none",
);
console.log(out.join("\n"));

const failed = unresolvedAfter.length > 0 || sanity.length > 0;
if (dry) process.exit(failed ? 1 : 0);
if (failed && !force) {
  console.error(
    "\nRefusing to touch the tree: some references would not resolve. Fix the mapping or pass --force.",
  );
  process.exit(1);
}

// -------------------------------------------------------------------- apply

const tmp = resolvePath(root, `.move-files-tmp-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const order = [...map];
try {
  order.forEach(([a], i) =>
    renameSync(resolvePath(root, a), resolvePath(tmp, String(i))),
  );
  order.forEach(([, b], i) => {
    mkdirSync(resolvePath(root, path.dirname(b)), { recursive: true });
    renameSync(resolvePath(tmp, String(i)), resolvePath(root, b));
  });
} catch (e) {
  console.error(
    `move failed half-way: ${e.message}\nfiles may be left in ${relativePath(root, tmp)}`,
  );
  process.exit(3);
}
rmSync(tmp, { recursive: true, force: true });
for (const [file, text] of edited)
  writeFileSync(resolvePath(root, map.get(file) ?? file), text);

const oldDirs = new Set();
for (const src of sources)
  for (let d = path.dirname(src); d !== "."; d = path.dirname(d))
    oldDirs.add(d);
let removed = 0;
for (const dir of [...oldDirs].sort(
  (a, b) => b.split("/").length - a.split("/").length,
)) {
  const abs = resolvePath(root, dir);
  try {
    let names = readdirSync(abs);
    if (names.length === 1 && names[0] === ".DS_Store") {
      rmSync(resolvePath(abs, ".DS_Store"));
      names = [];
    }
    if (!names.length) {
      rmdirSync(abs);
      removed++;
    }
  } catch {}
}
console.log(
  `\nMoved ${map.size} files, rewrote ${totalRewritten} references, removed ${removed} empty folders. Nothing was staged.`,
);
process.exit(0);
