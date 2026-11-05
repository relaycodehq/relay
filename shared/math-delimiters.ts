import { codeSpans } from "./code-spans";

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
  const closingLine = closingLineFinder(lines);
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
    const display = displayMath(lines, i, closingLine);
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
  closingLine: ClosingLineFinder,
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

  const last = closingLine(closer, from + 1);
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

type ClosingLineFinder = (closer: string, from: number) => number;

/**
 * The first line at or after `from` that ends with `closer`, or
 * `lines.length` when none does. It remembers the last search per closer, so
 * a run of openers that never close reads the rest of the text once, not once
 * per opener.
 */
function closingLineFinder(lines: string[]): ClosingLineFinder {
  const searched = new Map<string, { from: number; found: number }>();
  return (closer, from) => {
    const last = searched.get(closer);
    // Nothing between the last search's start and what it found ends with the
    // closer, so a later start up to that line finds the same one.
    if (last && last.from <= from && from <= last.found) return last.found;
    let found = from;
    while (
      found < lines.length &&
      !stripPrefix(lines[found]!).trimEnd().endsWith(closer)
    )
      found++;
    searched.set(closer, { from, found });
    return found;
  };
}

const stripPrefix = (line: string) => line.replace(/^[ \t>]*/, "");

function inlineMath(line: string): string {
  if (!/\\[([]|\$/.test(line)) return line;
  let out = "",
    at = 0;
  for (const span of codeSpans(line)) {
    out += convertInline(line.slice(at, span.index)) + span.text;
    at = span.index + span.text.length;
  }
  return out + convertInline(line.slice(at));
}

/**
 * `\[x\]` is also how prose escapes brackets, so it needs a formula's look.
 * A regular expression in prose, `\[\d+\]` or `\[\w{2,4}\]`, has its escapes
 * and counts set aside first; `\sigma` and `\frac` stay, being longer.
 */
const formulaLook = (tex: string) =>
  /[\\^_={}]/.test(
    tex
      .replace(/\\[dDwWsSbBntr](?![A-Za-z])|\\[.*+?()|/[\]-]/g, "")
      .replace(/\{\d+(?:,\d*)?\}/g, ""),
  );

// A formula never holds its own opener, so an unclosed one stops looking at
// the next; otherwise a long line of them takes quadratic time.
const INLINE_PARENS = /\\\(((?:(?!\\\().)+?)\\\)/g;
const INLINE_BRACKETS = /\\\[((?:(?!\\\[).)+?)\\\]/g;

const trimmedTex = (tex: string) => tex.trim() || tex;

function convertInline(text: string): string {
  const parens = text
    .replace(INLINE_PARENS, (_, tex: string) => `$$${trimmedTex(tex)}$$`)
    .replace(INLINE_BRACKETS, (all, tex: string) =>
      formulaLook(trimmedTex(tex)) ? `$$${trimmedTex(tex)}$$` : all,
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
    // A formula holds no other dollar, so the first one decides: the closer,
    // or proof this wasn't math ("$5 and $10, then $x$" pairs only the last two).
    if (
      /\s/.test(text[k - 1]!) ||
      text[k + 1] === "$" ||
      /\d/.test(text[k + 1] ?? "")
    )
      return -1;
    // "$HOME/$USER", "$a-$b", "cost=$cost, total=$total" and "/^\d+$/ … /^\w+$/":
    // a formula doesn't end on a separator or an operator waiting for its operand.
    return /[/:,;.\-=+*^_([{<>&]/.test(text[k - 1]!) ? -1 : k;
  }
  return -1;
}
