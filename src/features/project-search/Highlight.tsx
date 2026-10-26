import { Fragment, type ReactNode } from "react";

/** `text` with the given character ranges marked. */
export function Highlight({
  text,
  ranges,
}: {
  text: string;
  ranges: readonly { start: number; length: number }[];
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [i, { start, length }] of ranges.entries()) {
    const from = Math.max(cursor, Math.min(start, text.length));
    const to = Math.min(text.length, start + length);
    if (to <= from) continue;
    if (from > cursor) parts.push(text.slice(cursor, from));
    parts.push(<mark key={i}>{text.slice(from, to)}</mark>);
    cursor = to;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}

/** Ranges for each position in `indices`, adjacent ones joined. */
export function rangesOf(indices: readonly number[], shift = 0) {
  const ranges: { start: number; length: number }[] = [];
  for (const raw of indices) {
    const at = raw - shift;
    if (at < 0) continue;
    const last = ranges.at(-1);
    if (last && last.start + last.length === at) last.length++;
    else ranges.push({ start: at, length: 1 });
  }
  return ranges;
}
