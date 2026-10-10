import type { Position } from "unist";

/**
 * Whether a fenced block in `source` has its closing fence yet; until it
 * does, the answer is still streaming it in. An indented block has none.
 */
export function fenceClosed(source: string, position?: Position): boolean {
  const start = position?.start.offset,
    end = position?.end.offset;
  if (start === undefined || end === undefined) return true;
  // Inside a quote every line carries its `>`.
  const lines = source
    .slice(start, end)
    .split("\n")
    .map((line) => line.replace(/^[\s>]*/, "").trimEnd());
  const opening = /^(`{3,}|~{3,})/.exec(lines[0] ?? "")?.[1];
  if (!opening) return true;
  const closing = new RegExp(`^${opening[0]}{${opening.length},}$`);
  return lines.length > 1 && closing.test(lines[lines.length - 1]!);
}
/**
 * Whether a `$$` formula in `source` has its closing line yet, as
 * `fenceClosed` says for code; see `normalizeMath` for the shape it takes.
 */
export function mathClosed(source: string, position?: Position): boolean {
  const start = position?.start.offset,
    end = position?.end.offset;
  if (start === undefined || end === undefined) return true;
  const lines = source
    .slice(start, end)
    .split("\n")
    .map((line) => line.replace(/^[\s>]*/, "").trimEnd());
  // GitHub also takes a ```math fence.
  if (/^(`{3,}|~{3,})/.test(lines[0] ?? ""))
    return fenceClosed(source, position);
  return lines.length > 1 && lines[lines.length - 1] === "$$";
}
const MATH_FENCE = /^[ \t>]*\$\$[ \t]*$/;
/**
 * Lines that make every split unsafe, also inside quotes and list items: a
 * link or footnote definition is used from the whole text, and raw HTML can
 * run across blank lines (`<pre>`, `<script>`, comments) or swallow a fence.
 * An autolink like `<https://…>` is not a tag.
 */
const unsplittable =
  /^(?:[ \t>]|(?:[*+-]|\d{1,9}[.)])[ \t])*(?:\[[^\]]+\]:|<(?:[!?/]|[A-Za-z][A-Za-z0-9-]*(?:[ \t/>]|$)))/;

/**
 * Splits Markdown into top-level blocks at blank lines no construct spans:
 * outside fenced code, and before an unindented line that doesn't continue a
 * list. A streaming answer then re-parses only its last block.
 */
export function markdownBlocks(text: string): string[] {
  const lines = text.split("\n"),
    blocks: string[] = [];
  let start = 0,
    content = false,
    blank = false,
    math = false,
    fence: RegExp | undefined;
  for (const [i, line] of lines.entries()) {
    if (fence) {
      if (fence.test(line)) fence = undefined;
      continue;
    }
    // A formula may hold blank lines, like a fence; text is run through
    // normalizeMath first, so its `$$` lines stand alone.
    if (math) {
      if (MATH_FENCE.test(line)) math = false;
      continue;
    }
    if (!line.trim()) {
      blank = content;
      continue;
    }
    if (unsplittable.test(line)) return [text];
    if (blank && /^\S/.test(line) && !/^([*+-]|\d{1,9}[.)])(\s|$)/.test(line)) {
      blocks.push(lines.slice(start, i).join("\n"));
      start = i;
    }
    blank = false;
    content = true;
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (open) fence = new RegExp(`^ {0,3}${open[0]}{${open.length},}[ \\t]*$`);
    else if (MATH_FENCE.test(line)) math = true;
  }
  blocks.push(lines.slice(start).join("\n"));
  return blocks;
}
