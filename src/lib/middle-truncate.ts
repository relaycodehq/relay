/** What a label is, which decides the end worth keeping. */
export type MiddleKind = "path" | "branch";

/** A branch keeps about this many characters of its end. */
const BRANCH_TAIL = 14;
/** A bare file name keeps its extension when the extension is this short. */
const MAX_EXTENSION = 10;

/**
 * Splits a label into a head that may shorten and a tail that stays whole, so
 * a narrow label loses its middle: `src/features/ch…/ChangesPane.tsx`,
 * `relay/i-have-this-…-really-cool-i`. The two parts join back into `text`.
 */
export function middleSplit(text: string, kind: MiddleKind): [string, string] {
  if (kind === "path") {
    const slash = text.lastIndexOf("/", text.length - 2);
    if (slash > 0) return [text.slice(0, slash), text.slice(slash)];
    const dot = text.lastIndexOf(".");
    if (dot > 0 && text.length - dot <= MAX_EXTENSION)
      return [text.slice(0, dot), text.slice(dot)];
  } else {
    const slash = text.lastIndexOf("/");
    if (slash > 0 && text.length - slash <= BRANCH_TAIL + 1)
      return [text.slice(0, slash), text.slice(slash)];
  }
  const tail = Math.min(BRANCH_TAIL, Math.floor(text.length / 2));
  return [text.slice(0, text.length - tail), text.slice(text.length - tail)];
}

const ELLIPSIS = "…";

/** The largest n in 0…max for which `fits(n)` holds, given it holds for 0. */
function largest(max: number, fits: (n: number) => boolean) {
  let low = 0;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * `text` shortened to `width` by dropping the end of its head, so the tail
 * `middleSplit` keeps stays whole; when even the tail doesn't fit, as much of
 * its end as does. `measure` gives a string's drawn width.
 */
export function fitMiddle(
  text: string,
  kind: MiddleKind,
  width: number,
  measure: (text: string) => number,
) {
  if (measure(text) <= width) return text;
  const [head, tail] = middleSplit(text, kind);
  if (measure(ELLIPSIS + tail) > width) {
    const keep = largest(
      tail.length,
      (n) => measure(ELLIPSIS + tail.slice(tail.length - n)) <= width,
    );
    return ELLIPSIS + tail.slice(tail.length - keep);
  }
  const keep = largest(
    head.length,
    (n) => measure(head.slice(0, n) + ELLIPSIS + tail) <= width,
  );
  return head.slice(0, keep).trimEnd() + ELLIPSIS + tail;
}
