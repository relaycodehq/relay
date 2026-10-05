// Gitignore-style patterns, matched against paths relative to the folder the
// pattern file sits in, `/`-separated, without a leading or trailing slash.

interface Rule {
  negate: boolean;
  dirOnly: boolean;
  /** Holds a slash before its end, so it matches from the root only. */
  anchored: boolean;
  segments: string[];
  /** "i" where Git ignores case, as `core.ignorecase` repositories on macOS do. */
  flags: string;
  regex: RegExp;
}

const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** POSIX classes git's wildmatch knows, as regex class contents. */
const posix: Record<string, string> = {
  alnum: "a-zA-Z0-9",
  alpha: "a-zA-Z",
  blank: " \\t",
  cntrl: "\\x00-\\x1f\\x7f",
  digit: "0-9",
  graph: "\\x21-\\x7e",
  lower: "a-z",
  print: "\\x20-\\x7e",
  punct: "!-\\/:-@\\[-`{-~",
  space: "\\s",
  upper: "A-Z",
  xdigit: "0-9a-fA-F",
};

/**
 * A `[…]` class starting at `glob[start]`, as a regex class and where it
 * ends; null when it never closes, which git matches against nothing.
 */
function bracket(glob: string, start: number) {
  let i = start + 1;
  let out = "[";
  if (glob[i] === "!" || glob[i] === "^") {
    out += "^";
    i++;
  }
  // A `]` right after the opening is part of the class.
  for (let first = true; i < glob.length; i++, first = false) {
    const c = glob[i]!;
    if (c === "]" && !first) return { source: `${out}]`, end: i };
    if (c === "\\" && i + 1 < glob.length) out += escape(glob[++i]!);
    else if (c === "[" && glob[i + 1] === ":") {
      const close = glob.indexOf(":]", i + 2);
      const named = close > 0 ? posix[glob.slice(i + 2, close)] : undefined;
      if (named === undefined) return null;
      out += named;
      i = close + 1;
    } else out += c === "-" ? c : escape(c);
  }
  return null;
}

/** One path segment's glob as a regex source: `*`, `?`, `[…]` and `\x` escapes; null if it can't match. */
function segmentSource(glob: string): string | null {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "\\" && i + 1 < glob.length) out += escape(glob[++i]!);
    else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const cls = bracket(glob, i);
      if (!cls) return null;
      out += cls.source;
      i = cls.end;
    } else out += escape(c);
  }
  return out;
}

const never = /(?!)/;
const segmentRegex = (glob: string, flags: string) => {
  const source = segmentSource(glob);
  return source === null ? never : new RegExp(`^${source}$`, flags);
};

function parseLine(raw: string, flags: string): Rule | null {
  let line = raw.replace(/\r$/, "");
  if (!line || line.startsWith("#")) return null;
  // Spaces only, as git: a trailing tab is part of the name.
  line = line.replace(/(?<!\\) +$/, "");
  const negate = line.startsWith("!");
  if (negate) line = line.slice(1);
  else if (line.startsWith("\\!") || line.startsWith("\\#"))
    line = line.slice(1);
  const dirOnly = line.endsWith("/");
  line = line.replace(/\/+$/, "");
  if (!line) return null;
  const anchored = line.includes("/");
  const segments = line.replace(/^\/+/, "").split("/");
  if (!anchored) segments.unshift("**");
  const parts: string[] = [];
  for (const [i, seg] of segments.entries()) {
    const last = i === segments.length - 1;
    if (seg === "**") parts.push(last ? ".*" : "(?:[^/]*/)*");
    else {
      const source = segmentSource(seg);
      if (source === null)
        return { negate, dirOnly, anchored, segments, flags, regex: never };
      parts.push(source + (last ? "" : "/"));
    }
  }
  return {
    negate,
    dirOnly,
    anchored,
    segments,
    flags,
    regex: new RegExp(`^${parts.join("")}$`, flags),
  };
}

export function parsePatterns(text: string, { ignoreCase = false } = {}) {
  const flags = ignoreCase ? "i" : "";
  return text
    .replace(/^\uFEFF/, "")
    .split("\n")
    .flatMap((line) => parseLine(line, flags) ?? []);
}

/** Whether `path` matches: itself, or a folder it's in, the last matching rule deciding each. */
export function matches(rules: Rule[], path: string, isDir: boolean) {
  const test = (p: string, dir: boolean) => {
    let hit = false;
    for (const rule of rules)
      if ((dir || !rule.dirOnly) && rule.regex.test(p)) hit = !rule.negate;
    return hit;
  };
  const segments = path.split("/");
  for (let i = 1; i < segments.length; i++)
    if (test(segments.slice(0, i).join("/"), true)) return true;
  return test(path, isDir);
}

/**
 * Whether a pattern can match something inside folder `dir`, which doesn't
 * match itself. As Claude Code reads `.worktreeinclude`: a pattern naming
 * the folder's path reaches in, and one starting `**` only when the first
 * name after it is one of the folder path's names, so `.env` never sends
 * Relay walking through `node_modules`.
 */
export function reaches(rules: Rule[], dir: string) {
  const names = dir.split("/");
  return rules.some((rule) => {
    if (rule.negate) return false;
    const { segments } = rule;
    if (segments[0] === "**") {
      const first = segments.find((s) => s !== "**");
      if (!first) return true;
      const name = segmentRegex(first, rule.flags);
      return names.some((n) => name.test(n));
    }
    for (let i = 0; i < names.length; i++) {
      if (i >= segments.length - 1) return false;
      if (segments[i] === "**") return true;
      if (!segmentRegex(segments[i]!, rule.flags).test(names[i]!)) return false;
    }
    return segments.length > names.length;
  });
}
