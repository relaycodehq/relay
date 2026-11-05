export type MarkdownImage = {
  index: number;
  text: string;
  /** The destination, from whichever of its three forms the image used. */
  bracketed?: string;
  bare?: string;
  spaced?: string;
};

// A destination in <angle brackets> may hold spaces, like a macOS app data
// path. Agents often leave the brackets out, so a bare one with spaces counts
// too when it ends in a file Relay shows.
const DESTINATION =
  /\(\s*(?:<([^<>\n]+)>|([^\s<>()]+)|([^\s<>()][^<>()\n]*?\.(?:png|jpe?g|gif|webp|mp4|m4v|webm|mov)))(?:\s+["'][^"'\n]*["'])?\s*\)/iy;
const ALT_END = /[\]\n]/g;

/**
 * Every `![alt](src)` in `text`, as one expression starting with
 * `!\[[^\]\n]*\]` would find them, in linear time. That expression read each
 * `![` to the end of its alt, so a line of openers took quadratic time.
 * Every opener before the same `]` shares the destination after it, so each
 * `]` is read once.
 */
export function markdownImages(text: string): MarkdownImage[] {
  const images: MarkdownImage[] = [];
  let at = text.indexOf("![");
  while (at >= 0) {
    ALT_END.lastIndex = at + 2;
    const altEnd = ALT_END.exec(text)?.index;
    if (altEnd === undefined) break; // no later opener has an end either
    DESTINATION.lastIndex = altEnd + 1;
    const destination = text[altEnd] === "]" && DESTINATION.exec(text);
    if (destination) {
      const [, bracketed, bare, spaced] = destination;
      const end = DESTINATION.lastIndex;
      images.push({
        index: at,
        text: text.slice(at, end),
        bracketed,
        bare,
        spaced,
      });
      at = text.indexOf("![", end);
    } else at = text.indexOf("![", altEnd + 1);
  }
  return images;
}
