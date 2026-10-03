/** Every path a `git diff` touches, on either side of a rename or copy. */
export function diffPaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      for (const path of headerPaths(line.slice("diff --git ".length)))
        paths.add(path);
      continue;
    }
    const moved = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line);
    if (moved) paths.add(unquote(moved[1]));
  }
  return [...paths];
}

// `a/x b/y`, with either side C-quoted when the path has unusual characters.
// Unquoted paths may contain spaces, so an unrenamed file splits at the middle;
// a rename's real paths come from its `rename from/to` lines.
function headerPaths(header: string): string[] {
  if (header.startsWith('"') || header.endsWith('"')) {
    const quoted = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(
      header,
    );
    return quoted ? [quoted[1], quoted[2]].map(unquote).map(stripSide) : [];
  }
  const half = (header.length - 1) / 2;
  if (Number.isInteger(half)) {
    const a = header.slice(0, half),
      b = header.slice(half + 1);
    if (a.slice(2) === b.slice(2)) return [stripSide(a)];
  }
  return [];
}

const stripSide = (path: string) => path.replace(/^[ab]\//, "");

// Git's C-style quoting: octal escapes are UTF-8 bytes.
function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const bytes: number[] = [],
    body = value.slice(1, -1),
    escapes: Record<string, number> = {
      a: 7,
      b: 8,
      t: 9,
      n: 10,
      v: 11,
      f: 12,
      r: 13,
      '"': 34,
      "\\": 92,
    };
  for (const [, octal, escaped, text] of body.matchAll(
    /\\([0-7]{3})|\\(.)|([^\\]+)/gs,
  ))
    if (octal) bytes.push(parseInt(octal, 8));
    else if (escaped) bytes.push(escapes[escaped] ?? escaped.charCodeAt(0));
    else bytes.push(...new TextEncoder().encode(text));
  return new TextDecoder().decode(new Uint8Array(bytes));
}
