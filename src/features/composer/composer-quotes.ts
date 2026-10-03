// A quoted passage travels in the draft as a Markdown blockquote, so the
// agent and the transcript read it the same way the composer pill shows it.

/** Serialises a quote pill: every line prefixed, then a blank line. */
export const quoteMarkdown = (text: string) =>
  text
    .split("\n")
    .map((line) => "> " + line)
    .join("\n") + "\n\n";

/** A blockquote at the start of a line, including the blank line that ends it. */
export const quoteBlock = /(?<![^\n])(?:>[^\n]*(?:\n|$))+\n?/g;

/** The passage inside a blockquote block, inverse of quoteMarkdown. */
export const unquote = (block: string) =>
  block
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n");

/** Tidies a browser selection: trailing spaces and runs of blank lines go, indentation stays. */
export function selectionQuote(raw: string) {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** One-line preview for a pill or tooltip. */
export function quoteLabel(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}
