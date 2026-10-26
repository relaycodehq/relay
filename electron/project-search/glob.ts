/** Commas outside braces separate globs, so `*.{ts,tsx}` stays one. */
function splitOutsideBraces(text: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export interface Globs {
  include: string[];
  exclude: string[];
}

/**
 * The file masks typed in the two fields. A `!` in front of an include moves
 * it to the excludes. A trailing slash, a leading `./` or `/` is dropped:
 * `src/` and `src` both name the folder.
 */
export function parseGlobs(include = "", exclude = ""): Globs {
  const bare = (glob: string) =>
    glob
      .replace(/^!/, "")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
  const globs: Globs = { include: [], exclude: [] };
  for (const glob of splitOutsideBraces(include))
    (glob.startsWith("!") ? globs.exclude : globs.include).push(bare(glob));
  for (const glob of splitOutsideBraces(exclude))
    globs.exclude.push(bare(glob));
  return {
    include: globs.include.filter(Boolean),
    exclude: globs.exclude.filter(Boolean),
  };
}

/**
 * A glob as gitignore reads it, which is how ripgrep reads `--glob`: one
 * without a slash matches that name at any depth, one with a slash starts at
 * the root, `**` crosses folders. It also matches everything below a folder
 * it names.
 */
export function globRegExp(glob: string): RegExp {
  const anchored = glob.includes("/");
  let out = "";
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        i++;
        // `**/` also matches nothing at all: `a/**/b` is `a/b` too.
        if (glob[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else out += ".*";
      } else out += "[^/]*";
    } else if (ch === "?") out += "[^/]";
    else if (ch === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end < 0) out += "\\[";
      else {
        const body = glob.slice(i + 1, end).replace(/^!/, "^");
        out += `[${body.replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else if (ch === "{") {
      braces++;
      out += "(?:";
    } else if (ch === "}" && braces) {
      braces--;
      out += ")";
    } else if (ch === "," && braces) out += "|";
    else out += ch.replace(/[.+^$()|\\\]}]/g, "\\$&");
  }
  while (braces--) out += ")";
  return new RegExp(`${anchored ? "^" : "(?:^|/)"}(?:${out})(?:/.*)?$`);
}

/** Whether a path passes the masks: it matches an include, if any, and no exclude. */
export function pathFilter({ include, exclude }: Globs) {
  if (!include.length && !exclude.length) return undefined;
  const yes = include.map(globRegExp);
  const no = exclude.map(globRegExp);
  return (path: string) =>
    (!yes.length || yes.some((re) => re.test(path))) &&
    !no.some((re) => re.test(path));
}

/**
 * The `--glob` arguments that leave the excludes out of a ripgrep search,
 * each also naming what is below it. Includes are not passed: rg's globs
 * override .gitignore, so one would bring ignored files back in; the search
 * filters rg's matches by them with `pathFilter` instead.
 */
export function ripgrepExcludeArgs(exclude: string[]) {
  const args: string[] = [];
  for (const glob of exclude)
    args.push("--glob", `!${glob}`, "--glob", `!${glob}/**`);
  return args;
}
