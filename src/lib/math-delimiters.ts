/**
 * Agents write math four ways: `$$…$$`, `\[…\]`, `\(…\)` and `$…$`. The
 * Markdown parser only has to know one, so this rewrites the rest into it
 * before parsing: a display formula becomes a `$$` line, its lines, a `$$`
 * line; an inline one becomes `$$x$$`. `$` alone doesn't start math ("$5 and
 * $10" is prose), so `$x$` follows Pandoc's rule instead: no space inside the
 * dollars, no digit after the closing one.
 *
 * Code fences and code spans are left as they are. Applying it twice changes
 * nothing more than applying it once.
 */
export function normalizeMath(text: string): string {
  if (!/\\[([]|\$/.test(text)) return text;
  const lines = text.split("\n"),
    out: string[] = [];
  let fence: RegExp | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence) {
      out.push(line);
      if (fence.test(line)) fence = undefined;
      continue;
    }
    const open = /^[ \t>]*(`{3,}|~{3,})/.exec(line)?.[1];
    if (open) {
      fence = new RegExp(`^[ \\t>]*${open[0]}{${open.length},}[ \\t]*$`);
      out.push(line);
      continue;
    }
    const display = displayMath(lines, i);
    if (display) {
      out.push(...display.lines);
      i = display.last;
      continue;
    }
    out.push(inlineMath(line));
  }
  return out.join("\n");
}

const DISPLAY_OPENER = /^([ \t>]*)(\$\$|\\\[)(.*)$/;

/**
 * A formula that starts at the beginning of `lines[from]` and takes whole
 * lines, rewritten, with the index of its last line. None when the line
 * holds inline math or no formula at all.
 */
function displayMath(
  lines: string[],
  from: number,
): { lines: string[]; last: number } | undefined {
  const match = DISPLAY_OPENER.exec(lines[from]!);
  if (!match) return undefined;
  const [, prefix = "", opener = "", rest = ""] = match;
  const closer = opener === "$$" ? "$$" : "\\]";
  const fence = `${prefix}$$`;

  const end = rest.indexOf(closer);
  if (end >= 0) {
    // Text after the closer makes it part of a sentence.
    if (rest.slice(end + closer.length).trim()) return undefined;
    const body = rest.slice(0, end).trim();
    return {
      lines: body ? [fence, prefix + body, fence] : [fence, fence],
      last: from,
    };
  }

  let last = from + 1;
  while (
    last < lines.length &&
    !stripPrefix(lines[last]!).trimEnd().endsWith(closer)
  )
    last++;
  const closes = last < lines.length;
  if (!closes && opener !== "$$" && rest.trim()) return undefined;
  // Still streaming in: the formula runs to the end of what has arrived.
  if (!closes && rest.trim())
    return { lines: [`${prefix}\\$$${rest}`], last: from };

  const out = [fence];
  if (rest.trim()) out.push(prefix + rest.trim());
  if (!closes)
    return {
      lines: [...out, ...lines.slice(from + 1)],
      last: lines.length - 1,
    };
  out.push(...lines.slice(from + 1, last));
  const tail = stripPrefix(lines[last]!).trimEnd();
  const body = tail.slice(0, tail.length - closer.length).trim();
  if (body) out.push(prefix + body);
  out.push(fence);
  return { lines: out, last };
}

const stripPrefix = (line: string) => line.replace(/^[ \t>]*/, "");

const CODE_SPAN = /(`+)(?:[^`]|[^`].*?[^`])\1(?!`)/g;

function inlineMath(line: string): string {
  if (!/\\[([]|\$/.test(line)) return line;
  let out = "",
    at = 0;
  for (const span of line.matchAll(CODE_SPAN)) {
    out += convertInline(line.slice(at, span.index)) + span[0];
    at = span.index + span[0].length;
  }
  return out + convertInline(line.slice(at));
}

/** `\[x\]` is also how prose escapes brackets, so it needs a formula's look. */
const FORMULA_LOOK = /[\\^_={}]/;

function convertInline(text: string): string {
  const parens = text
    .replace(/\\\(\s*(.+?)\s*\\\)/g, (_, tex: string) => `$$${tex}$$`)
    .replace(/\\\[\s*(.+?)\s*\\\]/g, (all, tex: string) =>
      FORMULA_LOOK.test(tex) ? `$$${tex}$$` : all,
    );
  return pandocDollars(parens);
}

/** `$x$` into `$$x$$`, leaving `$$…$$`, `\$` and prose with prices alone. */
function pandocDollars(text: string): string {
  if (!text.includes("$")) return text;
  let out = "",
    at = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char !== "$") continue;
    if (text[i + 1] === "$") {
      const close = text.indexOf("$$", i + 2);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    const close = singleDollarEnd(text, i);
    if (close < 0) continue;
    out += `${text.slice(at, i)}$$${text.slice(i + 1, close)}$$`;
    at = close + 1;
    i = close;
  }
  return out + text.slice(at);
}

/** Where the `$x$` opened at `from` closes, or -1 when it isn't math. */
function singleDollarEnd(text: string, from: number): number {
  const before = text[from - 1],
    first = text[from + 1];
  if (!first || /\s/.test(first) || (before && /[A-Za-z0-9]/.test(before)))
    return -1;
  for (let k = from + 2; k < text.length; k++) {
    if (text[k] === "\\") {
      k++;
      continue;
    }
    if (text[k] !== "$") continue;
    if (/\s/.test(text[k - 1]!)) continue;
    if (text[k + 1] === "$" || /\d/.test(text[k + 1] ?? "")) continue;
    // "$HOME/$USER" and "$a-$b": a formula doesn't end on a separator.
    return /[/:,;.-]/.test(text[k - 1]!) ? -1 : k;
  }
  return -1;
}
