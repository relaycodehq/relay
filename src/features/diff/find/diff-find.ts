import type { FileDiffMetadata } from "@pierre/diffs";
import type { Side } from "../../../../shared/types";

/** A line the diff shows, by the side and number it is drawn with. */
export interface FindLine {
  side: Side;
  line: number;
  /** An unchanged line's number on the old side, where split view draws it again. */
  oldLine?: number;
  text: string;
}

export interface FindMatch {
  /** Index into the searched lines. */
  at: number;
  start: number;
  end: number;
}

/** Past this many the count reads "1000+" and the rest go unmarked. */
export const MAX_MATCHES = 1000;

const strip = (text: string | undefined) => (text ?? "").replace(/\r?\n$/, "");

/**
 * The lines a diff shows, in reading order: its hunks' unchanged and changed
 * lines, deletions before additions as the inline view draws them. With
 * `wholeFile` the unchanged code between hunks counts too, as when every
 * unchanged line is expanded.
 */
export function diffLines(diff: FileDiffMetadata, wholeFile = false) {
  const lines: FindLine[] = [];
  const context = (add: number, del: number, count: number) => {
    for (let i = 0; i < count; i++)
      lines.push({
        side: "additions",
        line: add + i + 1,
        oldLine: del + i + 1,
        text: strip(diff.additionLines[add + i]),
      });
  };
  const full = wholeFile && !diff.isPartial;
  let add = 0;
  let del = 0;
  for (const hunk of diff.hunks) {
    if (full) context(add, del, hunk.additionLineIndex - add);
    // Indexes are into the whole file, or the patch's own lines when partial;
    // a hunk's numbers start where its header says.
    const addNumber = (index: number) =>
      hunk.additionStart + index - hunk.additionLineIndex;
    const delNumber = (index: number) =>
      hunk.deletionStart + index - hunk.deletionLineIndex;
    for (const part of hunk.hunkContent) {
      if (part.type === "context") {
        for (let i = 0; i < part.lines; i++)
          lines.push({
            side: "additions",
            line: addNumber(part.additionLineIndex + i),
            oldLine: delNumber(part.deletionLineIndex + i),
            text: strip(diff.additionLines[part.additionLineIndex + i]),
          });
        continue;
      }
      for (let i = 0; i < part.deletions; i++)
        lines.push({
          side: "deletions",
          line: delNumber(part.deletionLineIndex + i),
          text: strip(diff.deletionLines[part.deletionLineIndex + i]),
        });
      for (let i = 0; i < part.additions; i++)
        lines.push({
          side: "additions",
          line: addNumber(part.additionLineIndex + i),
          text: strip(diff.additionLines[part.additionLineIndex + i]),
        });
    }
    add = hunk.additionLineIndex + hunk.additionCount;
    del = hunk.deletionLineIndex + hunk.deletionCount;
  }
  if (full) context(add, del, diff.additionLines.length - add);
  return lines;
}

/** Every place `query` appears, ignoring case, in reading order. */
export function findMatches(lines: FindLine[], query: string) {
  const matches: FindMatch[] = [];
  if (!query) return matches;
  const lower = query.toLowerCase();
  for (let at = 0; at < lines.length; at++) {
    const text = lines[at].text;
    let haystack = text.toLowerCase();
    let needle = lower;
    // Lowercasing can change a line's length (İ), and with it every offset.
    if (haystack.length !== text.length) {
      haystack = text;
      needle = query;
    }
    for (
      let start = haystack.indexOf(needle);
      start !== -1;
      start = haystack.indexOf(needle, start + needle.length)
    ) {
      matches.push({ at, start, end: start + needle.length });
      if (matches.length >= MAX_MATCHES) return matches;
    }
  }
  return matches;
}

/** How the viewer draws a line: its side and number. */
export const lineKey = (side: Side, line: number) => `${side}:${line}`;

/**
 * Matches by the drawn lines that hold them. An unchanged line is drawn on
 * both sides in split view, so it is found under either number.
 */
export function matchesByLine(lines: FindLine[], matches: FindMatch[]) {
  const byLine = new Map<string, number[]>();
  const add = (key: string, index: number) => {
    const list = byLine.get(key);
    if (list) list.push(index);
    else byLine.set(key, [index]);
  };
  matches.forEach((match, index) => {
    const line = lines[match.at];
    add(lineKey(line.side, line.line), index);
    if (line.oldLine !== undefined)
      add(lineKey("deletions", line.oldLine), index);
  });
  return byLine;
}

/** The match after (or before) `current`, wrapping around. */
export const stepMatch = (current: number, count: number, by: 1 | -1) =>
  count ? (current + by + count) % count : 0;
