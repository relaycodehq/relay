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
 * Splits Markdown into top-level blocks at blank lines no construct spans:
 * outside fenced code, and before an unindented line that doesn't continue a
 * list. A streaming answer then re-parses only its last block.
 */
export function markdownBlocks(text: string): string[] {
  // Definitions, footnotes and HTML comments reach across blank lines.
  if (/^ {0,3}\[[^\]]+\]:|<!--/m.test(text)) return [text];
  const lines = text.split("\n"),
    blocks: string[] = [];
  let start = 0,
    content = false,
    blank = false,
    fence: RegExp | undefined;
  lines.forEach((line, i) => {
    if (fence) {
      if (fence.test(line)) fence = undefined;
      return;
    }
    if (!line.trim()) {
      blank = content;
      return;
    }
    if (blank && /^\S/.test(line) && !/^([*+-]|\d{1,9}[.)])(\s|$)/.test(line)) {
      blocks.push(lines.slice(start, i).join("\n"));
      start = i;
    }
    blank = false;
    content = true;
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (open) fence = new RegExp(`^ {0,3}${open[0]}{${open.length},}[ \\t]*$`);
  });
  blocks.push(lines.slice(start).join("\n"));
  return blocks;
}
